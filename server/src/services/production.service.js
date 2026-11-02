import mongoose from "mongoose";
import { createHash } from "node:crypto";
import Product from "../models/product.model.js";
import Recipe from "../models/recipe.model.js";
import Ingredient from "../models/ingredient.model.js";
import User from "../models/user.model.js";
import Order from "../models/order.model.js";
import ProductionBatch from "../models/productionBatch.model.js";
import ProductionBatchCounter from "../models/productionBatchCounter.model.js";
import WastageRecord from "../models/wastageRecord.model.js";
import FinishedProductStock from "../models/finishedProductStock.model.js";
import { inventoryService } from "./inventory.service.js";
import {
  areUnitsConvertible,
  convertQuantity,
} from "../utils/measurement.utils.js";
import AppError from "../utils/appError.js";
import {
  CUSTOMER_ORDER_STATUSES,
  PRODUCTION_STATUS as S,
  USER_ROLES,
  HOLD_REASONS,
  HOLD_INSTRUCTIONS,
  HOLD_RESOLUTIONS,
  NOTIFICATION_TYPES,
} from "../utils/constants.js";
import { notificationService } from "./notification.service.js";
import capacityService from "./capacity.service.js";
import { roundQuantity } from "../utils/measurement.utils.js";
import costingService from "./costing.service.js";
import eventStream from "../utils/eventStream.js";
import orderService from "./order.service.js";

const managers = [
  USER_ROLES.OWNER_MANAGER,
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
  "OWNER",
  "MANAGER",
];
const assertId = (id) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest("Invalid batch ID");
};
const canManage = (user) => Boolean(user && managers.includes(user.role));
const canViewCosts = (user) => Boolean(user && [USER_ROLES.OWNER_MANAGER, USER_ROLES.OWNER].includes(user.role));
const workerFilter = (user) =>
  canManage(user) ? {} : { "assignedWorkers.worker": user._id };
const toMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const workerStartLocks = new Map();

async function withWorkerStartLock(workerIds, fn) {
  const sortedIds = Array.from(new Set((workerIds || []).map((id) => String(id)))).sort();
  if (sortedIds.length === 0) return fn();

  let releaseLocks;
  const currentPromise = new Promise((resolve) => {
    releaseLocks = resolve;
  });

  const prevLocks = sortedIds.map((id) => workerStartLocks.get(id) || Promise.resolve());

  sortedIds.forEach((id) => {
    workerStartLocks.set(id, currentPromise);
  });

  try {
    await Promise.all(prevLocks);
    return await fn();
  } finally {
    releaseLocks();
    sortedIds.forEach((id) => {
      if (workerStartLocks.get(id) === currentPromise) {
        workerStartLocks.delete(id);
      }
    });
  }
}

class ProductionService {
  async nextBatchNumber() {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const key = `BATCH-${date}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const counter = await ProductionBatchCounter.findOneAndUpdate(
          { _id: key },
          { $inc: { sequence: 1 } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        return `${key}-${String(counter.sequence).padStart(4, "0")}`;
      } catch (error) {
        if (error.code !== 11000 || attempt === 2) throw error;
      }
    }
  }
  async resolveAssignments(assignments, existingAssignments = []) {
    const ids = assignments.map((item) => item.worker);
    if (new Set(ids).size !== ids.length)
      throw AppError.badRequest(
        "A worker can only be assigned once to a batch",
      );
    if (!ids.length) return [];
    const workers = await User.find({
      _id: { $in: ids },
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    }).select("_id hourlyLabourRate");
    if (workers.length !== ids.length)
      throw AppError.badRequest(
        "Every assigned worker must be an active production staff member",
      );
    const byId = new Map(
      workers.map((worker) => [worker._id.toString(), worker]),
    );
    const existingById = new Map(
      (existingAssignments || []).map((w) => [String(w.worker), w]),
    );
    return assignments.map(({ worker, task = "", hourlyRateSnapshot: explicitSnapshot, actualHours }) => {
      const existing = existingById.get(String(worker));
      const workerRecord = byId.get(String(worker));
      let hourlyRateSnapshot = null;
      if (Number.isFinite(explicitSnapshot)) {
        hourlyRateSnapshot = explicitSnapshot;
      } else if (existing && Number.isFinite(existing.hourlyRateSnapshot)) {
        hourlyRateSnapshot = existing.hourlyRateSnapshot;
      } else if (Number.isFinite(workerRecord?.hourlyLabourRate)) {
        hourlyRateSnapshot = workerRecord.hourlyLabourRate;
      }
      return {
        worker,
        task: task || existing?.task || "",
        assignedAt: existing?.assignedAt || new Date(),
        hourlyRateSnapshot,
        actualHours: Number.isFinite(actualHours) ? actualHours : (existing?.actualHours ?? null),
        taskStatus: existing?.taskStatus || "PENDING",
      };
    });
  }
  async create(input, actor, { notifyAssignments = true } = {}) {
    const product = await Product.findOne({
      _id: input.product,
      isActive: true,
      isAvailable: true,
    });
    const variant = product?.variants.id(input.productVariant);
    if (!product || !variant || !variant.isActive || !variant.isAvailable)
      throw AppError.badRequest(
        "Product and product variant must exist and be active",
      );
    const recipe = await Recipe.findOne({
      product: product._id,
      variant: variant._id,
      isActive: true,
    }).populate("ingredients.ingredient", "name unit isActive");
    if (!recipe)
      throw AppError.badRequest(
        "An active recipe is required for this product variant",
      );
    if (
      !recipe.ingredients.length ||
      recipe.ingredients.some(
        (line) =>
          !line.ingredient ||
          !line.ingredient.isActive ||
          !areUnitsConvertible(line.unit, line.ingredient.unit),
      )
    )
      throw AppError.badRequest(
        "Recipe contains invalid or inactive ingredient information",
      );
    const recipeBatchQuantity = input.plannedQuantity / recipe.expectedYield;
    if (
      !Number.isFinite(recipeBatchQuantity) ||
      recipeBatchQuantity <= 0 ||
      Math.abs(
        recipeBatchQuantity * recipe.expectedYield - input.plannedQuantity,
      ) > 0.000001
    )
      throw AppError.badRequest(
        "Planned quantity must be a whole multiple of the recipe expected yield",
      );
    const relatedOrders = input.relatedOrders.length
      ? await Order.find({ _id: { $in: input.relatedOrders } })
      : [];
    if (relatedOrders.length !== input.relatedOrders.length)
      throw AppError.badRequest("Every related order must exist");
    for (const order of relatedOrders) {
      if (order.holdState?.isOnHold) {
        throw AppError.badRequest(
          `Order ${order.orderNumber || order._id} is currently on emergency hold. Held orders cannot be scheduled for production.`,
        );
      }
      if (order.status === CUSTOMER_ORDER_STATUSES.CANCELLED) {
        throw AppError.badRequest(
          `Order ${order.orderNumber || order._id} is cancelled. Cancelled orders cannot be scheduled for production.`,
        );
      }
      if (
        ![CUSTOMER_ORDER_STATUSES.CONFIRMED, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION].includes(order.status) ||
        !order.items.some(
          (line) =>
            String(line.productId) === String(product._id) &&
            String(line.variantId) === String(variant._id),
        )
      )
        throw AppError.badRequest(
          "Related orders must be confirmed bakery orders containing this product variant",
        );
    }
    const assignedWorkers = await this.resolveAssignments(
      input.assignedWorkers,
    );
    const ingredients = recipe.ingredients.map((line) => ({
      ingredient: line.ingredient._id,
      name: line.ingredient.name,
      quantity: Number((line.quantity * recipeBatchQuantity).toFixed(6)),
      unit: line.unit,
    }));

    const isPlanned = input.batchType === "PLANNED_PRODUCTION" || (!relatedOrders.length);
    const batchType = isPlanned ? "PLANNED_PRODUCTION" : (input.batchType || "CUSTOMER_ORDER");
    const plannedReason = isPlanned
      ? (input.plannedReason || "STOCK_REPLENISHMENT")
      : (input.plannedReason || "");
    const priority = input.priority || "NORMAL";
    const productionDate = input.productionDate
      ? new Date(`${input.productionDate}T00:00:00.000Z`)
      : (input.planning?.productionDate || (input.plannedStartTime ? new Date(input.plannedStartTime) : null));
    const timeSlot = input.timeSlot || input.planning?.timeSlot || undefined;

    let resourceChecks = input.planning?.resourceChecks || null;
    if (isPlanned && !resourceChecks) {
      try {
        const ingredientCheck = await this.assessIngredientResources({
          recipeSnapshot: { ingredients },
          recipeBatchQuantity,
        });
        resourceChecks = { ingredients: ingredientCheck };
      } catch {
        // ignore
      }
    }

    const batch = await ProductionBatch.create({
      batchNumber: await this.nextBatchNumber(),
      batchType,
      plannedReason,
      priority,
      productionDate,
      timeSlot,
      product: product._id,
      productVariant: variant._id,
      productSnapshot: {
        productName: product.name,
        variantName: variant.name,
        variantQuantity: variant.quantity,
        variantUnit: variant.unit,
        totalTimeMinutes: product.totalTimeMinutes ?? ((product.preparationTime || 0) + (product.productionTime || 0)),
        preparationTimePerUnit: product.preparationTimePerUnit ?? product.preparationTime ?? 0,
        electricityCostPerUnit: product.electricityCostPerUnit ?? 0,
        packagingCostPerUnit: product.packagingCostPerUnit ?? 0,
      },
      recipe: recipe._id,
      recipeRevision: recipe.revision,
      recipeSnapshot: {
        expectedYield: recipe.expectedYield,
        yieldUnit: recipe.yieldUnit,
        recipeBatchQuantity,
        ingredients,
        preparationTime: recipe.preparationTime || 0,
        productionTime: recipe.productionTime || 0,
        powerMinutes: recipe.powerMinutes ?? null,
        powerCostPerMinute: recipe.powerCostPerMinute ?? 0,
        estimatedDurationMinutes: recipe.estimatedDurationMinutes || ((recipe.preparationTime || 0) + (recipe.productionTime || 0)) || 30,
        equipmentPowerKw: recipe.equipmentPowerKw !== undefined && recipe.equipmentPowerKw !== null ? Number(recipe.equipmentPowerKw) : undefined,
        electricityTariff: recipe.electricityTariff !== undefined && recipe.electricityTariff !== null ? Number(recipe.electricityTariff) : undefined,
        packagingCostPerUnit: recipe.packagingCostPerUnit || 0,
        packagingMaterials: recipe.packagingMaterials || [],
      },
      plannedQuantity: input.plannedQuantity,
      estimatedDurationMinutes: input.estimatedDurationMinutes || recipe.estimatedDurationMinutes || ((recipe.preparationTime || 0) + (recipe.productionTime || 0)) || 30,
      unit: recipe.yieldUnit,
      assignedWorkers,
      plannedStartTime: input.plannedStartTime ?? null,
      ...(input.planning || {}),
      resourceChecks,
      relatedOrders: relatedOrders.map((order) => order._id),
      productionNotes: input.productionNotes || "",
      ownerInstructions: input.ownerInstructions || "",
      syncOrderStatus: Boolean(input.syncOrderStatus),
      createdBy: actor._id,
    });
    if (notifyAssignments) await this.notifyAssignedWorkers(batch);
    return batch;
  }
  async assignOrder(orderId, workerInput, actor, ownerInstructions) {
    assertId(orderId);
    const order = await Order.findById(orderId);
    if (!order) throw AppError.notFound("Order not found");
    if (order.status !== CUSTOMER_ORDER_STATUSES.CONFIRMED)
      throw AppError.conflict("Only confirmed orders can be assigned to production");

    if (order.holdState?.isOnHold) {
      throw AppError.conflict(
        `Order ${order.orderNumber || order._id} is currently on emergency hold. Held orders cannot be assigned to production.`,
      );
    }
    if (order.status === CUSTOMER_ORDER_STATUSES.CANCELLED) {
      throw AppError.conflict(
        `Order ${order.orderNumber || order._id} is cancelled. Cancelled orders cannot be assigned to production.`,
      );
    }

    // Payment gate: production assignment requires verified payment
    const isPaid = order.paymentStatus === "PAYMENT_CONFIRMED" || (order.paymentMethod === "RAZORPAY" && order.paymentSummary?.status === "CAPTURED");
    if (!isPaid && order.paymentMethod !== "COD") {
      throw AppError.conflict(
        `Order payment is unverified (payment status: ${order.paymentStatus}). Verified payment is required before production assignment.`,
      );
    }

    const rawWorkerIds = Array.isArray(workerInput)
      ? workerInput
      : workerInput?.workers
        ? workerInput.workers
        : workerInput?.worker
          ? [workerInput.worker]
          : (typeof workerInput === "string" || (workerInput && mongoose.isValidObjectId(workerInput)))
            ? [workerInput]
            : [];

    const isFullyFulfilledFromStock =
      (order.items || []).length > 0 &&
      order.items.every((item) => {
        const fc = (order.finishedCommitments || []).find(
          (c) =>
            String(c.product) === String(item.productId) &&
            String(c.variant) === String(item.variantId)
        );
        return (fc?.quantity || 0) >= item.quantity;
      });

    if (!rawWorkerIds.length && !isFullyFulfilledFromStock) {
      throw AppError.badRequest("Choose at least one production staff member");
    }

    const workers = rawWorkerIds.length > 0
      ? await User.find({
          _id: { $in: rawWorkerIds },
          role: USER_ROLES.PRODUCTION_STAFF,
          isActive: true,
        })
      : [];
    if (rawWorkerIds.length > 0 && workers.length !== rawWorkerIds.length) {
      throw AppError.badRequest("Every selected staff member must be an active production staff account");
    }

    const currentBatches = await ProductionBatch.find({ relatedOrders: order._id }).select("product productVariant status");
    const results = [];
    for (const item of order.items) {
      const existing = currentBatches.find((batch) =>
        String(batch.product) === String(item.productId) &&
        String(batch.productVariant) === String(item.variantId) &&
        ![S.REJECTED, S.CANCELLED].includes(batch.status)
      );
      if (existing) {
        results.push(existing);
        continue;
      }

      // Check finished commitments: if already fulfilled from stock, do not schedule unnecessary batch
      const finishedCommitment = (order.finishedCommitments || []).find(
        (c) => String(c.product) === String(item.productId) && String(c.variant) === String(item.variantId)
      );
      const finishedQty = finishedCommitment?.quantity || 0;
      const remainingQty = Math.max(0, item.quantity - finishedQty);

      if (remainingQty <= 0) {
        // Item is 100% fulfilled from available finished goods stock; no production needed
        continue;
      }

      const recipe = await Recipe.findOne({ product: item.productId, variant: item.variantId, isActive: true });
      if (!recipe) throw AppError.badRequest(`An active recipe is required for "${item.productName}" before assigning production`);

      const totalDuration = (recipe.preparationTime || 0) + (recipe.productionTime || 0);
      if (totalDuration <= 0) {
        throw AppError.badRequest(
          `Recipe for "${item.productName}" must define a positive preparation or production duration in minutes before scheduling production.`,
        );
      }

      const plannedQuantity = Math.ceil(remainingQty / recipe.expectedYield) * recipe.expectedYield;
      results.push(await this.create({
        product: item.productId,
        productVariant: item.variantId,
        plannedQuantity,
        relatedOrders: [order._id],
        syncOrderStatus: true,
        batchType: "CUSTOMER_ORDER",
        assignedWorkers: workers.map((w) => ({ worker: w._id, task: `Prepare ${item.productName}` })),
        productionNotes: item.specialInstructions || order.specialInstructions || "",
        ownerInstructions: typeof ownerInstructions === "string" ? ownerInstructions : (typeof workerInput === "object" && workerInput?.ownerInstructions) || "",
      }, actor));
    }

    if (results.length === 0 && (order.items || []).length > 0) {
      // All items were fulfilled directly from available finished stock
      if (order.status === CUSTOMER_ORDER_STATUSES.CONFIRMED) {
        await Order.updateOne(
          { _id: order._id },
          { $set: { status: CUSTOMER_ORDER_STATUSES.READY } }
        );
        if (order.customer) {
          await notificationService.createSafely({
            recipient: order.customer,
            type: "ORDER_STATUS_CHANGED",
            title: "Order Ready from Finished Stock",
            message: `Order ${order.orderNumber} is fulfilled directly from available stock and ready for ${order.orderType === "PICKUP" ? "pickup" : "delivery"}.`,
            relatedEntityType: "ORDER",
            relatedEntityId: order._id,
            dedupeKey: `order:${order._id}:READY_STOCK`,
          });
        }
      }
    }
    return results;
  }
  async notifyAssignedWorkers(batch) {
    for (const assignment of batch.assignedWorkers)
      await notificationService.createSafely({
        recipient: assignment.worker,
        type: "PRODUCTION_ASSIGNED",
        title: "Production batch assigned",
        message: `You were assigned to batch ${batch.batchNumber}.`,
        relatedEntityType: "PRODUCTION_BATCH",
        relatedEntityId: batch._id,
        dedupeKey: `production-assigned:${batch._id}:${assignment.worker}`,
      });
  }
  async notifyManagers(type, title, message, batch) {
    const supervisors = await User.find({ role: { $in: managers }, isActive: true }).select("_id");
    for (const supervisor of supervisors)
      await notificationService.createSafely({
        recipient: supervisor._id,
        type,
        title,
        message,
        relatedEntityType: "PRODUCTION_BATCH",
        relatedEntityId: batch._id,
        dedupeKey: `production-${type.toLowerCase()}:${batch._id}:${batch.updatedAt?.getTime?.() || Date.now()}`,
      });
  }

  assertHoldAllowsTransition(batch, actionName) {
    if (!batch?.holdState?.isOnHold) return;
    const instruction = batch.holdState.holdInstruction;
    const permittedStep = batch.holdState.permittedStep;
    const stepFinished = batch.holdState.stepFinishedReported;

    if (instruction === HOLD_INSTRUCTIONS.STOP_IMMEDIATELY) {
      throw AppError.conflict(
        `Production on batch ${batch.batchNumber} is on EMERGENCY HOLD: "${HOLD_INSTRUCTIONS.STOP_IMMEDIATELY}". Reason: ${batch.holdState.holdReason || "Unspecified"}. No production actions are permitted until resolved by owner.`
      );
    }

    if (instruction === HOLD_INSTRUCTIONS.CONTINUE_CURRENT_STEP) {
      if (permittedStep && actionName !== permittedStep) {
        throw AppError.conflict(
          `Production on batch ${batch.batchNumber} is on HOLD: Permitted only to complete current step (${permittedStep}). Step "${actionName}" is blocked until hold is resolved.`
        );
      }
    }

    if (instruction === HOLD_INSTRUCTIONS.STOP_AFTER_CURRENT_STEP) {
      if (stepFinished) {
        throw AppError.conflict(
          `Production on batch ${batch.batchNumber} is on HOLD: Current safe production step has finished and baker reported safe stopping point reached. Subsequent step "${actionName}" is blocked until hold is resolved.`
        );
      }
      if (permittedStep && actionName !== permittedStep) {
        throw AppError.conflict(
          `Production on batch ${batch.batchNumber} is on HOLD: Permitted only to complete current step (${permittedStep}). Step "${actionName}" is blocked until hold is resolved.`
        );
      }
    }
  }

  getPermittedStepForBatch(batch, instruction) {
    if (instruction === HOLD_INSTRUCTIONS.STOP_IMMEDIATELY) {
      return "";
    }
    switch (batch.status) {
      case S.PLANNED:
        return "ACCEPT";
      case S.ACCEPTED:
        return "VERIFY";
      case S.VERIFIED:
        return "START_BAKING";
      case S.IN_PRODUCTION:
        return "RECORD_OUTPUT";
      case S.QUALITY_CHECK:
      case S.PACKAGING:
        return "PACKAGE";
      default:
        return "";
    }
  }

  async placeHold(id, input, user) {
    assertId(id);
    if (!canManage(user)) {
      throw AppError.forbidden("Only owners and managers can place production batches on hold");
    }
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");

    if (batch.holdState?.isOnHold) {
      throw AppError.conflict(`Batch ${batch.batchNumber} is already on hold`);
    }

    const nonHoldableStatuses = [S.COMPLETED, S.DELIVERED, S.CANCELLED, S.REJECTED];
    if (nonHoldableStatuses.includes(batch.status)) {
      throw AppError.conflict(`Cannot place a hold on batch in terminal status ${batch.status}`);
    }

    const permittedStep = this.getPermittedStepForBatch(batch, input.instruction);
    const holdRequestedAt = new Date();

    const auditEntry = {
      action: "HOLD_PLACED",
      actor: user._id,
      actorRole: user.role,
      reason: input.reason,
      instruction: input.instruction,
      note: input.ownerNote || "",
      timestamp: holdRequestedAt,
    };

    batch.holdState = {
      isOnHold: true,
      holdReason: input.reason,
      holdInstruction: input.instruction,
      ownerNote: input.ownerNote || "",
      holdRequestedAt,
      holdRequestedBy: user._id,
      instructionVersion: 1,
      permittedStep,
      stepFinishedReported: false,
      bakerAcknowledged: false,
      bakerAcknowledgedAt: null,
      bakerAcknowledgedBy: null,
      bakerResponse: null,
      holdResolvedAt: null,
      holdResolvedBy: null,
      holdResolution: "",
      resolutionNote: "",
      auditTrail: [auditEntry],
    };

    await batch.save();

    if (batch.relatedOrders && batch.relatedOrders.length > 0) {
      await Order.updateMany(
        { _id: { $in: batch.relatedOrders } },
        {
          $set: {
            "holdState.isOnHold": true,
            "holdState.holdReason": input.reason,
            "holdState.holdInstruction": input.instruction,
            "holdState.ownerNote": input.ownerNote || "",
            "holdState.holdRequestedAt": holdRequestedAt,
            "holdState.holdRequestedBy": user._id,
            "holdState.instructionVersion": 1,
            "holdState.bakerAcknowledged": false,
            "holdState.bakerAcknowledgedAt": null,
            "holdState.bakerResponse": null,
            "holdState.holdResolvedAt": null,
            "holdState.holdResolvedBy": null,
            "holdState.holdResolution": "",
            "holdState.resolutionNote": "",
            "holdState.relatedBatch": batch._id,
          },
        }
      );
    }

    for (const assignment of batch.assignedWorkers || []) {
      await notificationService.createSafely({
        recipient: assignment.worker,
        type: NOTIFICATION_TYPES.PRODUCTION_HOLD,
        title: "EMERGENCY HOLD: Production batch on hold",
        message: `Batch ${batch.batchNumber} has been placed on EMERGENCY HOLD: ${input.reason}. Instruction: ${input.instruction}. Check workstation immediately.`,
        relatedEntityType: "PRODUCTION_BATCH",
        relatedEntityId: batch._id,
        metadata: {
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          reason: input.reason,
          instruction: input.instruction,
          ownerNote: input.ownerNote || "",
          instructionVersion: 1,
        },
        dedupeKey: `hold-placed:${batch._id}:v1:${assignment.worker}`,
      });
    }

    eventStream.broadcast("PRODUCTION_HOLD", {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      holdState: batch.holdState,
      relatedOrders: batch.relatedOrders,
    });

    return batch;
  }

  async updateHoldInstruction(id, input, user) {
    assertId(id);
    if (!canManage(user)) {
      throw AppError.forbidden("Only owners and managers can update hold instructions");
    }
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");

    if (!batch.holdState?.isOnHold) {
      throw AppError.conflict(`Batch ${batch.batchNumber} is not currently on hold`);
    }

    const newVersion = (batch.holdState.instructionVersion || 1) + 1;
    const permittedStep = this.getPermittedStepForBatch(batch, input.instruction);
    const updatedAt = new Date();

    const auditEntry = {
      action: "INSTRUCTION_UPDATED",
      actor: user._id,
      actorRole: user.role,
      instruction: input.instruction,
      note: input.ownerNote !== undefined ? input.ownerNote : (batch.holdState.ownerNote || ""),
      timestamp: updatedAt,
    };

    batch.holdState.holdInstruction = input.instruction;
    if (input.ownerNote !== undefined) {
      batch.holdState.ownerNote = input.ownerNote;
    }
    batch.holdState.instructionVersion = newVersion;
    batch.holdState.permittedStep = permittedStep;
    batch.holdState.stepFinishedReported = false;
    batch.holdState.bakerAcknowledged = false;
    batch.holdState.bakerAcknowledgedAt = null;
    batch.holdState.bakerAcknowledgedBy = null;
    batch.holdState.bakerResponse = null;

    if (!batch.holdState.auditTrail) batch.holdState.auditTrail = [];
    batch.holdState.auditTrail.push(auditEntry);

    await batch.save();

    if (batch.relatedOrders && batch.relatedOrders.length > 0) {
      await Order.updateMany(
        { _id: { $in: batch.relatedOrders } },
        {
          $set: {
            "holdState.holdInstruction": input.instruction,
            ...(input.ownerNote !== undefined ? { "holdState.ownerNote": input.ownerNote } : {}),
            "holdState.instructionVersion": newVersion,
            "holdState.bakerAcknowledged": false,
            "holdState.bakerAcknowledgedAt": null,
            "holdState.bakerResponse": null,
          },
        }
      );
    }

    for (const assignment of batch.assignedWorkers || []) {
      await notificationService.createSafely({
        recipient: assignment.worker,
        type: NOTIFICATION_TYPES.PRODUCTION_HOLD_UPDATED,
        title: "HOLD INSTRUCTION UPDATED",
        message: `Hold instruction for batch ${batch.batchNumber} was updated to: ${input.instruction}. Please acknowledge immediately.`,
        relatedEntityType: "PRODUCTION_BATCH",
        relatedEntityId: batch._id,
        metadata: {
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          instruction: input.instruction,
          instructionVersion: newVersion,
        },
        dedupeKey: `hold-updated:${batch._id}:v${newVersion}:${assignment.worker}`,
      });
    }

    eventStream.broadcast("PRODUCTION_HOLD_UPDATED", {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      holdState: batch.holdState,
      relatedOrders: batch.relatedOrders,
    });

    return batch;
  }

  async acknowledgeHold(id, input, user) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");

    if (!batch.holdState?.isOnHold) {
      throw AppError.conflict(`Batch ${batch.batchNumber} is not currently on hold`);
    }

    const isAssigned = (batch.assignedWorkers || []).some(
      (a) => String(a.worker) === String(user._id)
    );
    if (!isAssigned && !canManage(user)) {
      throw AppError.forbidden("Only assigned production staff or managers can acknowledge this hold");
    }

    const acknowledgedAt = new Date();
    const bakerResponse = {
      currentStage: input.currentStage || batch.status,
      workCompleted: input.workCompleted || "",
      ingredientsConsumed: Boolean(input.ingredientsConsumed),
      safeStoppingPointReached: Boolean(input.safeStoppingPointReached),
      note: input.note || "",
    };

    batch.holdState.bakerAcknowledged = true;
    batch.holdState.bakerAcknowledgedAt = acknowledgedAt;
    batch.holdState.bakerAcknowledgedBy = user._id;
    batch.holdState.bakerResponse = bakerResponse;

    if (input.safeStoppingPointReached) {
      batch.holdState.stepFinishedReported = true;
    }

    const auditEntry = {
      action: "BAKER_ACKNOWLEDGED",
      actor: user._id,
      actorRole: user.role,
      bakerResponse,
      timestamp: acknowledgedAt,
    };

    if (!batch.holdState.auditTrail) batch.holdState.auditTrail = [];
    batch.holdState.auditTrail.push(auditEntry);

    await batch.save();

    if (batch.relatedOrders && batch.relatedOrders.length > 0) {
      await Order.updateMany(
        { _id: { $in: batch.relatedOrders } },
        {
          $set: {
            "holdState.bakerAcknowledged": true,
            "holdState.bakerAcknowledgedAt": acknowledgedAt,
            "holdState.bakerResponse": bakerResponse,
          },
        }
      );
    }

    await this.notifyManagers(
      NOTIFICATION_TYPES.PRODUCTION_HOLD_ACKNOWLEDGED,
      "Baker acknowledged production hold",
      `${user.name || "Baker"} acknowledged hold on batch ${batch.batchNumber}. Current stage: ${bakerResponse.currentStage}. Ingredients consumed: ${bakerResponse.ingredientsConsumed ? "YES" : "NO"}.`,
      batch
    );

    eventStream.broadcast("PRODUCTION_HOLD_ACKNOWLEDGED", {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      holdState: batch.holdState,
      acknowledgedBy: { _id: user._id, name: user.name },
    });

    return batch;
  }

  async resolveHold(id, input, user) {
    assertId(id);
    if (!canManage(user)) {
      throw AppError.forbidden("Only owners and managers can resolve production holds");
    }
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");

    if (!batch.holdState?.isOnHold) {
      throw AppError.conflict(`Batch ${batch.batchNumber} is not currently on hold`);
    }

    const resolvedAt = new Date();
    const resolution = input.resolution;
    const resolutionNote = input.resolutionNote || "";

    const auditEntry = {
      action: "HOLD_RESOLVED",
      actor: user._id,
      actorRole: user.role,
      resolution,
      note: resolutionNote,
      timestamp: resolvedAt,
    };

    if (resolution === HOLD_RESOLUTIONS.RESUME) {
      batch.holdState.isOnHold = false;
      batch.holdState.holdResolvedAt = resolvedAt;
      batch.holdState.holdResolvedBy = user._id;
      batch.holdState.holdResolution = resolution;
      batch.holdState.resolutionNote = resolutionNote;
      if (!batch.holdState.auditTrail) batch.holdState.auditTrail = [];
      batch.holdState.auditTrail.push(auditEntry);
      await batch.save();

      if (batch.relatedOrders && batch.relatedOrders.length > 0) {
        await Order.updateMany(
          { _id: { $in: batch.relatedOrders } },
          {
            $set: {
              "holdState.isOnHold": false,
              "holdState.holdResolvedAt": resolvedAt,
              "holdState.holdResolvedBy": user._id,
              "holdState.holdResolution": resolution,
              "holdState.resolutionNote": resolutionNote,
            },
          }
        );
      }

      for (const assignment of batch.assignedWorkers || []) {
        await notificationService.createSafely({
          recipient: assignment.worker,
          type: NOTIFICATION_TYPES.PRODUCTION_HOLD_RESOLVED,
          title: "PRODUCTION RESUMED",
          message: `Hold on batch ${batch.batchNumber} has been resolved: Resume normal production. ${resolutionNote ? `Note: ${resolutionNote}` : ""}`,
          relatedEntityType: "PRODUCTION_BATCH",
          relatedEntityId: batch._id,
          metadata: { batchId: batch._id, batchNumber: batch.batchNumber, resolution },
          dedupeKey: `hold-resumed:${batch._id}:${resolvedAt.getTime()}:${assignment.worker}`,
        });
      }
    } else if (resolution === HOLD_RESOLUTIONS.CANCEL_ORDER) {
      if (input.cancelOrderId) {
        await orderService.cancelFromProductionHold(input.cancelOrderId, user, resolutionNote);
        const remainingActiveOrders = await Order.find({
          _id: { $in: batch.relatedOrders, $ne: input.cancelOrderId },
          status: { $nin: [CUSTOMER_ORDER_STATUSES.CANCELLED, CUSTOMER_ORDER_STATUSES.EXPIRED] },
        });

        if (remainingActiveOrders.length === 0) {
          batch.status = S.CANCELLED;
          batch.cancelledBy = user._id;
          batch.cancelledAt = resolvedAt;
          batch.cancellationReason = `All related orders cancelled: ${resolutionNote}`;
        }
      } else {
        for (const orderId of batch.relatedOrders || []) {
          try {
            await orderService.cancelFromProductionHold(orderId, user, resolutionNote);
          } catch (err) {
            // ignore
          }
        }
        batch.status = S.CANCELLED;
        batch.cancelledBy = user._id;
        batch.cancelledAt = resolvedAt;
        batch.cancellationReason = `Cancelled by manager from hold: ${resolutionNote}`;
      }

      batch.holdState.isOnHold = false;
      batch.holdState.holdResolvedAt = resolvedAt;
      batch.holdState.holdResolvedBy = user._id;
      batch.holdState.holdResolution = resolution;
      batch.holdState.resolutionNote = resolutionNote;
      if (!batch.holdState.auditTrail) batch.holdState.auditTrail = [];
      batch.holdState.auditTrail.push(auditEntry);
      await batch.save();
    } else if (resolution === HOLD_RESOLUTIONS.STOP_AND_WASTAGE) {
      batch.status = S.CANCELLED;
      batch.cancelledBy = user._id;
      batch.cancelledAt = resolvedAt;
      batch.cancellationReason = `Batch stopped for wastage review: ${resolutionNote}`;

      batch.holdState.isOnHold = false;
      batch.holdState.holdResolvedAt = resolvedAt;
      batch.holdState.holdResolvedBy = user._id;
      batch.holdState.holdResolution = resolution;
      batch.holdState.resolutionNote = resolutionNote;
      if (!batch.holdState.auditTrail) batch.holdState.auditTrail = [];
      batch.holdState.auditTrail.push(auditEntry);
      await batch.save();

      if (input.cancelOrderId) {
        await orderService.cancelFromProductionHold(input.cancelOrderId, user, resolutionNote);
      }
    } else {
      batch.holdState.isOnHold = false;
      batch.holdState.holdResolvedAt = resolvedAt;
      batch.holdState.holdResolvedBy = user._id;
      batch.holdState.holdResolution = resolution;
      batch.holdState.resolutionNote = resolutionNote;
      if (!batch.holdState.auditTrail) batch.holdState.auditTrail = [];
      batch.holdState.auditTrail.push(auditEntry);
      await batch.save();
    }

    eventStream.broadcast("PRODUCTION_HOLD_RESOLVED", {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      resolution,
      holdState: batch.holdState,
    });

    return batch;
  }
  makePlanningKey({ productionDate, productVariant, plannedQuantity, relatedOrders, timeSlot }) {
    const identity = JSON.stringify({
      productionDate,
      productVariant: String(productVariant),
      plannedQuantity,
      relatedOrders: relatedOrders.map(String).sort(),
      timeSlot,
    });
    return createHash("sha256").update(identity).digest("hex");
  }
  async createPlan(input, actor) {
    const productionDate = new Date(`${input.productionDate}T00:00:00.000Z`);
    const plannedStartTime = new Date(`${input.productionDate}T${input.timeSlot.startTime}:00.000Z`);
    const planningKey = this.makePlanningKey({ ...input, productionDate });
    try {
      const batch = await this.create({
        ...input,
        plannedStartTime,
        planning: {
          productionDate,
          timeSlot: input.timeSlot,
          planningKey,
          planningStatus: "DRAFT",
          planningFeasibility: null,
          resourceChecks: null,
          planningCheckedAt: null,
          approvedBy: null,
          approvedAt: null,
        },
      }, actor, { notifyAssignments: false });
      return await this.refreshPlanFeasibility(batch._id);
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.planningKey)
        throw AppError.conflict("An equivalent production plan already exists for this slot");
      throw error;
    }
  }
  async assessPlanResources(batch) {
    const ingredientCheck = await this.assessIngredientResources(batch);
    const ingredientRows = ingredientCheck.requirements;
    const ingredientsStatus = ingredientCheck.status;
    const workerIds = batch.assignedWorkers.map((assignment) => assignment.worker);
    const activeWorkers = workerIds.length
      ? await User.find({ _id: { $in: workerIds }, role: USER_ROLES.PRODUCTION_STAFF, isActive: true }).select("_id")
      : [];
    let staffStatus = activeWorkers.length === workerIds.length && workerIds.length > 0 ? "AVAILABLE" : "UNAVAILABLE";
    let workerConflicts = [];
    if (staffStatus === "AVAILABLE" && batch.productionDate && batch.timeSlot?.startTime && batch.timeSlot?.endTime) {
      const scheduled = await ProductionBatch.find({
        _id: { $ne: batch._id },
        productionDate: batch.productionDate,
        status: { $nin: [S.CANCELLED, S.REJECTED, S.QUALITY_FAILED, S.COMPLETED, S.PACKAGED, S.DELIVERED] },
        "assignedWorkers.worker": { $in: workerIds },
      }).select("batchNumber timeSlot plannedStartTime");
      workerConflicts = scheduled.filter((other) => {
        if (!other.timeSlot?.startTime || !other.timeSlot?.endTime) return false;
        return toMinutes(batch.timeSlot.startTime) < toMinutes(other.timeSlot.endTime) &&
          toMinutes(other.timeSlot.startTime) < toMinutes(batch.timeSlot.endTime);
      }).map((other) => ({ batch: other._id, batchNumber: other.batchNumber }));
      if (workerConflicts.length) staffStatus = "CONFLICT";
    }

    const recipe = await Recipe.findById(batch.recipe).select("preparationTime productionTime");
    const estimatedDurationMinutes = (recipe?.preparationTime || 0) + (recipe?.productionTime || 0);
    const slotMinutes = batch.timeSlot?.startTime && batch.timeSlot?.endTime
      ? toMinutes(batch.timeSlot.endTime) - toMinutes(batch.timeSlot.startTime)
      : 0;
    const timeSlotStatus = !batch.timeSlot?.startTime || !batch.timeSlot?.endTime
      ? "UNAVAILABLE"
      : slotMinutes < estimatedDurationMinutes ? "TOO_SHORT" : "AVAILABLE";
    const capacity = await capacityService.assess({
      productionRequired: true,
      estimatedMinutes: estimatedDurationMinutes * batch.recipeSnapshot.recipeBatchQuantity,
      maxTaskMinutes: estimatedDurationMinutes,
      date: batch.productionDate || new Date(),
    });
    const feasible = ingredientsStatus === "SUFFICIENT" && staffStatus === "AVAILABLE" &&
      timeSlotStatus === "AVAILABLE" && ["AVAILABLE", "SUFFICIENT"].includes(capacity.status);
    const checkedAt = new Date();
    return {
      feasible,
      checkedAt,
      estimatedDurationMinutes,
      ingredients: { status: ingredientsStatus, shortages: ingredientRows.filter((line) => line.orderRequired) },
      staff: { status: staffStatus, assignedCount: workerIds.length, conflicts: workerConflicts },
      capacity,
      timeSlot: { status: timeSlotStatus, ...batch.timeSlot?.toObject?.() ?? batch.timeSlot, durationMinutes: slotMinutes },
      resources: { ingredients: ingredientRows, staffStatus, capacityStatus: capacity.status, timeSlotStatus },
    };
  }
  async assessIngredientResources(batch) {
    const ingredientRows = [];
    for (const line of batch.recipeSnapshot.ingredients) {
      const { ingredient, currentStock } = await inventoryService.getCurrentStock(line.ingredient);
      const valid = ingredient?.isActive && areUnitsConvertible(line.unit, ingredient.unit);
      const required = valid ? convertQuantity(line.quantity, line.unit, ingredient.unit) : line.quantity;
      const available = valid
        ? Math.max(0, roundQuantity(currentStock - (ingredient.reservedStock || 0) - (ingredient.productionReservedStock || 0) - ingredient.minimumStock))
        : 0;
      const difference = roundQuantity(required - available);
      const shortage = Math.max(0, difference);
      ingredientRows.push({
        ingredient: ingredient?._id || line.ingredient,
        name: ingredient?.name || line.name,
        required,
        available,
        shortage,
        unit: ingredient?.unit || line.unit,
        status: !valid ? "UNAVAILABLE" : difference > 0.000001 ? "INSUFFICIENT" : "SUFFICIENT",
        orderRequired: !valid || difference > 0.000001,
      });
    }
    const ingredientsStatus = ingredientRows.some((line) => line.status === "UNAVAILABLE")
      ? "UNAVAILABLE"
      : ingredientRows.some((line) => line.status === "INSUFFICIENT") ? "INSUFFICIENT" : "SUFFICIENT";
    return { requirements: ingredientRows, status: ingredientsStatus };
  }
  async refreshPlanFeasibility(id) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production plan not found");
    if (!batch.planningStatus) throw AppError.badRequest("Batch is not a production plan");
    if (batch.status !== S.PLANNED || batch.planningStatus === "APPROVED")
      throw AppError.conflict("Only unapproved planned work can be checked");
    const feasibility = await this.assessPlanResources(batch);
    const result = await ProductionBatch.findOneAndUpdate(
      { _id: id, status: S.PLANNED, planningStatus: { $ne: "APPROVED" }, updatedAt: batch.updatedAt },
      {
        $set: {
          planningFeasibility: feasibility,
          resourceChecks: feasibility.resources,
          planningCheckedAt: feasibility.checkedAt,
          planningStatus: feasibility.feasible ? "FEASIBLE" : "INFEASIBLE",
        },
      },
      { new: true },
    );
    if (!result) throw AppError.conflict("Plan changed while feasibility was being checked; retry");
    return result;
  }
  async listPlans(date) {
    const day = new Date(`${date}T00:00:00.000Z`);
    return ProductionBatch.find({ productionDate: day, planningStatus: { $exists: true } })
      .sort({ plannedStartTime: 1, createdAt: -1 })
      .populate("product", "name")
      .populate("recipe", "preparationTime productionTime duration powerMinutes equipmentPowerKw electricityTariff packagingCostPerUnit packagingMaterials estimatedDurationMinutes")
      .populate("assignedWorkers.worker", "name email jobDesignation")
      .populate("relatedOrders", "orderNumber status specialInstructions packInstructions items deliveryDate deliveryTimeSlot contactName contactPhone");
  }
  async getPlan(id) {
    assertId(id);
    const batch = await ProductionBatch.findOne({ _id: id, planningStatus: { $exists: true } })
      .populate("product", "name")
      .populate("recipe", "preparationTime productionTime duration powerMinutes equipmentPowerKw electricityTariff packagingCostPerUnit packagingMaterials estimatedDurationMinutes")
      .populate("assignedWorkers.worker", "name email jobDesignation")
      .populate("relatedOrders", "orderNumber status specialInstructions packInstructions items deliveryDate deliveryTimeSlot contactName contactPhone");
    if (!batch) throw AppError.notFound("Production plan not found");
    return batch;
  }
  async updatePlan(id, input) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch || !batch.planningStatus) throw AppError.notFound("Production plan not found");
    if (batch.status !== S.PLANNED || batch.planningStatus === "APPROVED")
      throw AppError.conflict("Only unapproved planned work can be adjusted");
    const nextQuantity = input.plannedQuantity ?? batch.plannedQuantity;
    const recipeYield = batch.recipeSnapshot.expectedYield;
    const recipeBatchQuantity = nextQuantity / recipeYield;
    if (!Number.isFinite(recipeBatchQuantity) || recipeBatchQuantity <= 0 || Math.abs(recipeBatchQuantity * recipeYield - nextQuantity) > 0.000001)
      throw AppError.badRequest("Planned quantity must be a whole multiple of the recipe expected yield");
    let assigned = batch.assignedWorkers;
    if (input.assignedWorkers) assigned = await this.resolveAssignments(input.assignedWorkers);
    const relatedOrders = input.relatedOrders ?? batch.relatedOrders;
    if (input.relatedOrders) {
      const orders = relatedOrders.length ? await Order.find({ _id: { $in: relatedOrders } }) : [];
      if (orders.length !== relatedOrders.length || orders.some((order) =>
        order.status !== CUSTOMER_ORDER_STATUSES.CONFIRMED || !order.items.some((line) =>
          String(line.productId) === String(batch.product) && String(line.variantId) === String(batch.productVariant))))
        throw AppError.badRequest("Related orders must be confirmed orders containing this product variant");
    }
    const productionDate = input.productionDate
      ? new Date(`${input.productionDate}T00:00:00.000Z`)
      : batch.productionDate;
    const timeSlot = input.timeSlot ?? batch.timeSlot;
    const plannedStartTime = new Date(`${productionDate.toISOString().slice(0, 10)}T${timeSlot.startTime}:00.000Z`);
    const scale = recipeBatchQuantity / batch.recipeSnapshot.recipeBatchQuantity;
    const recipeSnapshot = {
      ...batch.recipeSnapshot.toObject(),
      recipeBatchQuantity,
      ingredients: batch.recipeSnapshot.ingredients.map((line) => ({
        ...line.toObject(),
        quantity: roundQuantity(line.quantity * scale),
      })),
    };
    const planningKey = this.makePlanningKey({
      productionDate,
      productVariant: batch.productVariant,
      plannedQuantity: nextQuantity,
      relatedOrders,
      timeSlot,
    });
    try {
      const updated = await ProductionBatch.findOneAndUpdate(
        { _id: id, status: S.PLANNED, planningStatus: { $ne: "APPROVED" }, updatedAt: batch.updatedAt },
        {
          $set: {
            plannedQuantity: nextQuantity,
            recipeSnapshot,
            assignedWorkers: assigned,
            relatedOrders,
            productionDate,
            timeSlot,
            plannedStartTime,
            planningKey,
            planningStatus: "DRAFT",
            planningFeasibility: null,
            resourceChecks: null,
            planningCheckedAt: null,
            approvedBy: null,
            approvedAt: null,
            ...(input.productionNotes !== undefined ? { productionNotes: input.productionNotes } : {}),
          },
        },
        { new: true },
      );
      if (!updated) throw AppError.conflict("Plan changed while being adjusted; reload and retry");
      return await this.refreshPlanFeasibility(updated._id);
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.planningKey)
        throw AppError.conflict("An equivalent production plan already exists for this slot");
      throw error;
    }
  }
  async approvePlan(id, approver) {
    const checked = await this.refreshPlanFeasibility(id);
    if (!checked.planningFeasibility?.feasible)
      throw AppError.conflict(
        "Plan cannot be approved because one or more resource checks failed",
        [checked.planningFeasibility],
      );
    const approvedAt = new Date();
    const approved = await ProductionBatch.findOneAndUpdate(
      { _id: id, status: S.PLANNED, planningStatus: "FEASIBLE", approvedAt: null, updatedAt: checked.updatedAt },
      { $set: { planningStatus: "APPROVED", approvedBy: approver._id, approvedAt } },
      { new: true },
    );
    if (!approved) throw AppError.conflict("Plan changed or was approved by another request");
    await this.notifyAssignedWorkers(approved);
    return approved;
  }
  async list({ page = 1, limit = 20, status }, user) {
    const filter = { ...workerFilter(user), ...(status ? { status } : {}) };
    const projection = canViewCosts(user)
      ? null
      : "-costing -consumedIngredients.unitCostSnapshot -consumedIngredients.purchase -consumedIngredients.vendor -consumedIngredients.supplierNameSnapshot";
    const [batches, total] = await Promise.all([
      ProductionBatch.find(filter)
        .select(projection)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("product", "name")
        .populate("recipe", "preparationTime productionTime duration powerMinutes equipmentPowerKw electricityTariff packagingCostPerUnit packagingMaterials estimatedDurationMinutes")
        .populate("assignedWorkers.worker", "name email jobDesignation")
        .populate("relatedOrders", "orderNumber status specialInstructions packInstructions items deliveryDate deliveryTimeSlot contactName contactPhone"),
      ProductionBatch.countDocuments(filter),
    ]);
    return {
      batches,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
  async get(id, user) {
    assertId(id);
    const batch = await ProductionBatch.findOne({
      _id: id,
      ...workerFilter(user),
    }).select(canViewCosts(user) ? null : "-costing -consumedIngredients.unitCostSnapshot -consumedIngredients.purchase -consumedIngredients.vendor -consumedIngredients.supplierNameSnapshot")
      .populate("product", "name")
      .populate("recipe", "preparationTime productionTime duration powerMinutes equipmentPowerKw electricityTariff packagingCostPerUnit packagingMaterials estimatedDurationMinutes")
      .populate("assignedWorkers.worker", "name email jobDesignation")
      .populate("relatedOrders", "orderNumber status specialInstructions packInstructions items deliveryDate deliveryTimeSlot contactName contactPhone")
      .populate("consumedIngredients.ingredient", "name")
      .populate("consumedIngredients.lot", "lotNumber");
    if (!batch) throw AppError.notFound("Production batch not found");
    const wastageQuery = WastageRecord.find({ productionBatch: batch._id })
      .sort({ recordedAt: 1 })
      .populate("inventoryLot", "lotNumber")
      .populate("inventoryTransaction", "type direction quantity unit createdAt");
    if (!canViewCosts(user)) wastageQuery.select("-valuePaise -vendor -purchase -supplierNameSnapshot");
    const wastageRecords = await wastageQuery;
    return { ...batch.toObject(), wastageRecords };
  }
  async update(id, input) {
    assertId(id);
    const batch = await ProductionBatch.findOne({ _id: id, status: S.PLANNED });
    if (!batch) throw AppError.conflict("Only planned batches can be edited");
    if (input.assignedWorkers)
      batch.assignedWorkers = await this.resolveAssignments(
        input.assignedWorkers,
        batch.assignedWorkers,
      );
    if (Object.hasOwn(input, "plannedStartTime"))
      batch.plannedStartTime = input.plannedStartTime;
    if (input.productionNotes !== undefined)
      batch.productionNotes = input.productionNotes;
    const result = await ProductionBatch.findOneAndUpdate(
      { _id: batch._id, status: S.PLANNED, updatedAt: batch.updatedAt },
      {
        $set: {
          assignedWorkers: batch.assignedWorkers,
          plannedStartTime: batch.plannedStartTime,
          productionNotes: batch.productionNotes,
        },
      },
      { new: true },
    );
    if (!result)
      throw AppError.conflict(
        "Batch changed while it was being edited; reload and retry",
      );
    if (input.assignedWorkers)
      for (const assignment of result.assignedWorkers)
        await notificationService.createSafely({
          recipient: assignment.worker,
          type: "PRODUCTION_ASSIGNED",
          title: "Production batch assigned",
          message: `You were assigned to batch ${result.batchNumber}.`,
          relatedEntityType: "PRODUCTION_BATCH",
          relatedEntityId: result._id,
          dedupeKey: `production-assigned:${result._id}:${assignment.worker}`,
        });
    return result;
  }
  assertAssigned(batch, user) {
    if (
      !canManage(user) &&
      !batch.assignedWorkers.some(
        (item) => String(item.worker) === String(user._id),
      )
    )
      throw AppError.forbidden("You can only work on batches assigned to you");
  }
  batchPlan(batch) {
    return {
      batchNumber: batch.batchNumber,
      product: batch.product,
      plannedQuantity: batch.plannedQuantity,
      relatedOrders: batch.relatedOrders,
      assignedWorkers: batch.assignedWorkers.map((item) => item.worker),
    };
  }
  assertPlanMatches(submitted, expected) {
    const sameIds = (left = [], right = []) =>
      left.map(String).sort().join(",") === right.map(String).sort().join(",");
    const fields = [
      [submitted.batchNumber === expected.batchNumber, "batch identity"],
      [String(submitted.product) === String(expected.product), "product"],
      [submitted.plannedQuantity === expected.plannedQuantity, "planned quantity"],
      [sameIds(submitted.relatedOrders, expected.relatedOrders), "source orders"],
      [sameIds(submitted.assignedWorkers, expected.assignedWorkers), "staff assignment"],
    ];
    const mismatch = fields.find(([matches]) => !matches);
    if (mismatch)
      throw AppError.conflict(
        `Batch verification failed: ${mismatch[1]} does not match the batch plan`,
      );
  }
  async accept(id, input, user) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");
    this.assertAssigned(batch, user);
    if (batch.status !== S.PLANNED)
      throw AppError.conflict(`Cannot accept a batch from ${batch.status}`);
    if (batch.planningStatus && batch.planningStatus !== "APPROVED")
      throw AppError.conflict("Production plan must be approved before staff acceptance");
    if (!batch.assignedWorkers.length)
      throw AppError.conflict("Assign at least one worker before accepting a batch");
    if (input && Object.keys(input).length > 0) {
      this.assertPlanMatches(input, this.batchPlan(batch));
    }
    const acceptedAt = new Date();
    const result = await ProductionBatch.findOneAndUpdate(
      { _id: id, status: S.PLANNED, acceptedAt: null, updatedAt: batch.updatedAt },
      {
        $set: {
          status: S.ACCEPTED,
          acceptedPlan: this.batchPlan(batch),
          acceptedBy: user._id,
          acceptedAt,
        },
      },
      { new: true },
    );
    if (!result) throw AppError.conflict("Batch was accepted by another request");
    await this.notifyManagers(
      "PRODUCTION_ACCEPTED",
      "Production assignment accepted",
      `${user.name || "A production staff member"} accepted batch ${result.batchNumber}.`,
      result,
    );
    return result;
  }
  async verify(id, input, user) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");
    this.assertAssigned(batch, user);
    this.assertHoldAllowsTransition(batch, "VERIFY");
    if (batch.status !== S.ACCEPTED || !batch.acceptedPlan)
      throw AppError.conflict("Only an accepted batch can be verified");
    this.assertPlanMatches(input, batch.acceptedPlan);
    this.assertPlanMatches(input, this.batchPlan(batch));
    const verifiedAt = new Date();
    const result = await ProductionBatch.findOneAndUpdate(
      { _id: id, status: S.ACCEPTED, verificationStatus: "PENDING" },
      {
        $set: {
          status: S.VERIFIED,
          verificationStatus: "VERIFIED",
          verifiedBy: user._id,
          verifiedAt,
        },
      },
      { new: true },
    );
    if (!result) throw AppError.conflict("Batch was verified by another request");
    return result;
  }
  async reject(id, input, user) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");
    this.assertAssigned(batch, user);
    if (![S.PLANNED, S.ACCEPTED].includes(batch.status))
      throw AppError.conflict(`Cannot reject a batch from ${batch.status}`);
    const activeAssignment = batch.assignedWorkers.find((item) => String(item.worker) === String(user._id));
    if (!activeAssignment) throw AppError.forbidden("Only the currently assigned worker can reject this batch");
    const now = new Date();
    const rejections = [...(batch.assignmentRejections || []), { worker: user._id, reason: input.reason, rejectedAt: now }];
    const excluded = [...rejections.map((item) => item.worker), ...batch.assignedWorkers.map((item) => item.worker)];
    const nextWorker = await User.findOne({
      _id: { $nin: excluded },
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    }).sort({ createdAt: 1, _id: 1 });
    const nextAssignments = nextWorker
      ? await this.resolveAssignments([{ worker: nextWorker._id, task: activeAssignment.task || "Production" }])
      : [];
    const update = {
      $set: {
        status: nextWorker ? S.PLANNED : S.REJECTED,
        assignedWorkers: nextAssignments,
        assignmentRejections: rejections,
        acceptedPlan: null,
        acceptedBy: null,
        acceptedAt: null,
        verificationStatus: "PENDING",
        verifiedBy: null,
        verifiedAt: null,
        rejectedBy: user._id,
        rejectedAt: nextWorker ? null : now,
        rejectionReason: input.reason,
      },
    };
    const rejected = await ProductionBatch.findOneAndUpdate(
      { _id: id, status: batch.status, updatedAt: batch.updatedAt },
      update,
      { new: true },
    );
    if (!rejected) throw AppError.conflict("Batch changed while rejection was being saved; reload and retry");
    await this.notifyManagers(
      "PRODUCTION_REJECTED",
      nextWorker ? "Batch reassigned after rejection" : "Production batch needs reassignment",
      nextWorker
        ? `Batch ${rejected.batchNumber} was rejected by ${user.name || "a staff member"} and reassigned to ${nextWorker.name}. Reason: ${input.reason}`
        : `Batch ${rejected.batchNumber} was rejected by ${user.name || "a staff member"}; no eligible staff remain. Reason: ${input.reason}`,
      rejected,
    );
    if (nextWorker) await this.notifyAssignedWorkers(rejected);
    return rejected;
  }
  async start(id, user, options = {}) {
    assertId(id);
    const initialBatch = await ProductionBatch.findById(id);
    if (!initialBatch) throw AppError.notFound("Production batch not found");
    this.assertAssigned(initialBatch, user);

    const workerIds = (initialBatch.assignedWorkers || []).map((x) => x.worker);
    if (!workerIds.length) {
      throw AppError.badRequest(
        "Assign at least one active worker before starting production",
      );
    }

    return withWorkerStartLock(workerIds, async () => {
      const batch = await ProductionBatch.findById(id);
      if (!batch) throw AppError.notFound("Production batch not found");
      this.assertAssigned(batch, user);
      this.assertHoldAllowsTransition(batch, "START_BAKING");

      if (![S.ACCEPTED, S.VERIFIED].includes(batch.status))
        throw AppError.conflict(`Cannot start a batch from ${batch.status}`);
      if (!batch.assignedWorkers.length)
        throw AppError.badRequest(
          "Assign at least one active worker before starting production",
        );
      const assignments = await User.find({
        _id: { $in: batch.assignedWorkers.map((x) => x.worker) },
        role: USER_ROLES.PRODUCTION_STAFF,
        isActive: true,
      }).select("_id name");
      if (assignments.length !== batch.assignedWorkers.length)
        throw AppError.conflict(
          "A batch worker is inactive or no longer eligible",
        );

      // Concurrency rule: 1 active production batch per worker
      const activeRunningBatch = await ProductionBatch.findOne({
        _id: { $ne: batch._id },
        "assignedWorkers.worker": { $in: batch.assignedWorkers.map((x) => x.worker) },
        status: { $in: [S.IN_PRODUCTION, S.QUALITY_CHECK, S.PACKAGING] },
      }).select("batchNumber assignedWorkers status");

      if (activeRunningBatch) {
        throw AppError.conflict(
          `A worker assigned to this batch already has an actively running production batch (${activeRunningBatch.batchNumber}). Concurrency policy strictly limits each staff member to one active batch.`,
        );
      }

      // Validate ingredient availability before starting production (if not already consumed)
      if (batch.consumptionStatus !== "CONSUMED") {
        const ingredientCheck = await this.assessIngredientResources(batch);
        const failedIngredients = ingredientCheck.requirements.filter(
          (line) => line.status !== "SUFFICIENT",
        );
        if (failedIngredients.length > 0) {
          const unavailable = failedIngredients.find((fi) => fi.status === "UNAVAILABLE");
          if (unavailable) {
            throw AppError.conflict(
              `Ingredient ${unavailable.name} is inactive or has incompatible units`,
            );
          }
          const details = failedIngredients
            .map(
              (fi) =>
                `${fi.name}: required ${fi.required} ${fi.unit}, available ${fi.available} ${fi.unit}, shortage ${fi.shortage} ${fi.unit}`,
            )
            .join("; ");
          throw AppError.conflict(
            `Insufficient available inventory for production: ${details}`,
          );
        }
      }
      const startTime = batch.actualStartTime || new Date();
      const currentWorkerIds = batch.assignedWorkers.map((item) => item.worker);
      const result = await ProductionBatch.findOneAndUpdate(
        { _id: id, status: { $in: [S.ACCEPTED, S.VERIFIED] } },
        {
          $set: {
            status: S.IN_PRODUCTION,
            verificationStatus: "VERIFIED",
            verifiedBy: batch.verifiedBy || user._id,
            verifiedAt: batch.verifiedAt || startTime,
            actualStartTime: startTime,
            bakingStartTime: batch.bakingStartTime || startTime,
            "assignedWorkers.$[worker].taskStatus": "IN_PROGRESS",
          },
        },
        { new: true, arrayFilters: [{ "worker.worker": { $in: currentWorkerIds } }] },
      );
      if (!result)
        throw AppError.conflict("Batch was started by another request");

      // Auto-consume ingredients if explicitly requested at start (direct floor batches without pre-requisition)
      if (options?.autoConsume && result.consumptionStatus === "NOT_STARTED") {
        const consumedIngredients = await inventoryService.consumeForProduction(
          result,
          user._id,
        );
        result.consumptionStatus = "CONSUMED";
        result.consumedIngredients = consumedIngredients;
        await result.save();
      }

      // Double-check against concurrent starts across processes/nodes
      const duplicateActive = await ProductionBatch.findOne({
        _id: { $ne: result._id },
        "assignedWorkers.worker": { $in: currentWorkerIds },
        status: { $in: [S.IN_PRODUCTION, S.QUALITY_CHECK, S.PACKAGING] },
      }).select("batchNumber");

      if (duplicateActive) {
        await ProductionBatch.updateOne(
          { _id: result._id, status: S.IN_PRODUCTION },
          {
            $set: {
              status: batch.status,
              actualStartTime: batch.actualStartTime || null,
              bakingStartTime: batch.bakingStartTime || null,
              "assignedWorkers.$[worker].taskStatus": "PENDING",
            },
          },
          { arrayFilters: [{ "worker.worker": { $in: currentWorkerIds } }] },
        );
        throw AppError.conflict(
          `A worker assigned to this batch already has an actively running production batch (${duplicateActive.batchNumber}). Concurrency policy strictly limits each staff member to one active batch.`,
        );
      }

      // Sync related orders to IN_PRODUCTION if syncOrderStatus is enabled
      if (result.syncOrderStatus && result.relatedOrders?.length) {
        for (const orderId of result.relatedOrders) {
          const order = await Order.findById(orderId);
          if (order && order.status === CUSTOMER_ORDER_STATUSES.CONFIRMED) {
            await Order.updateOne(
              { _id: order._id, status: CUSTOMER_ORDER_STATUSES.CONFIRMED },
              { $set: { status: CUSTOMER_ORDER_STATUSES.IN_PRODUCTION } },
            );
            if (order.customer) {
              await notificationService.createSafely({
                recipient: order.customer,
                type: "ORDER_STATUS_CHANGED",
                title: "Order In Production",
                message: `Order ${order.orderNumber} is now in production.`,
                relatedEntityType: "ORDER",
                relatedEntityId: order._id,
                dedupeKey: `order:${order._id}:IN_PRODUCTION`,
              });
            }
          }
        }
      }

      return result;
    });
  }
  async consume(id, user) {
    assertId(id);
    const current = await ProductionBatch.findById(id);
    if (!current) throw AppError.notFound("Production batch not found");
    this.assertAssigned(current, user);
    this.assertHoldAllowsTransition(current, "CONSUME");
    if (current.consumptionStatus === "CONSUMED") {
      throw AppError.conflict("Batch ingredients have already been consumed");
    }
    const claim = await ProductionBatch.findOneAndUpdate(
      {
        _id: id,
        status: { $in: [S.VERIFIED, S.IN_PRODUCTION] },
        consumptionStatus: "NOT_STARTED",
      },
      { $set: { consumptionStatus: "PROCESSING" } },
      { new: true },
    );
    if (!claim) {
      const exists = await ProductionBatch.findById(id);
      if (!exists) throw AppError.notFound("Production batch not found");
      if (exists.consumptionStatus === "CONSUMED") return exists;
      throw AppError.conflict(
        "Batch ingredients were already consumed or are being consumed",
      );
    }
    try {
      const consumedIngredients = await inventoryService.consumeForProduction(
        claim,
        user._id,
      );
      const result = await ProductionBatch.findOneAndUpdate(
        { _id: id, consumptionStatus: "PROCESSING" },
        { $set: { consumptionStatus: "CONSUMED", consumedIngredients } },
        { new: true },
      );
      if (!result)
        throw AppError.conflict(
          "Batch changed during ingredient consumption; reconciliation is required",
        );
      return result;
    } catch (error) {
      await ProductionBatch.updateOne(
        { _id: id, consumptionStatus: "PROCESSING" },
        { $set: { consumptionStatus: "NOT_STARTED" } },
      );
      throw error;
    }
  }
  async complete(id, input, user) {
    assertId(id);
    const current = await ProductionBatch.findById(id);
    if (!current) throw AppError.notFound("Production batch not found");
    this.assertAssigned(current, user);
    this.assertHoldAllowsTransition(current, "RECORD_OUTPUT");

    if (current.consumptionStatus !== "CONSUMED") {
      const consumedIngredients = await inventoryService.consumeForProduction(
        current,
        user._id,
      );
      current.consumptionStatus = "CONSUMED";
      current.consumedIngredients = consumedIngredients;
      await current.save();
    }

    const claim = await ProductionBatch.findOneAndUpdate(
      {
        _id: id,
        status: S.IN_PRODUCTION,
        verificationStatus: "VERIFIED",
        consumptionStatus: "CONSUMED",
        completionStatus: "NOT_STARTED",
      },
      { $set: { completionStatus: "PROCESSING" } },
      { new: true },
    );
    if (!claim) {
      const exists = await ProductionBatch.exists({ _id: id });
      if (!exists) throw AppError.notFound("Production batch not found");
      throw AppError.conflict(
        "Batch must be in production with ingredients consumed and not already completed",
      );
    }
    try {
      const actualCompletionTime = new Date();
      const startTime = claim.bakingStartTime || claim.actualStartTime || claim.verifiedAt || actualCompletionTime;
      const diffMs = actualCompletionTime.getTime() - new Date(startTime).getTime();
      const bakingElapsedMinutes = Math.max(1, Math.round(diffMs / 60000));
      const equipmentRuntimeMinutes = Number.isFinite(input.equipmentRuntimeMinutes)
        ? input.equipmentRuntimeMinutes
        : bakingElapsedMinutes;
      const elapsedHours = Math.max(0.01, Number((diffMs / (1000 * 60 * 60)).toFixed(2)));

      const assignedWorkers = claim.assignedWorkers.map((aw) => {
        const obj = aw.toObject ? aw.toObject() : { ...aw };
        if (obj.actualHours === null || obj.actualHours === undefined) {
          obj.actualHours = elapsedHours;
        }
        obj.taskStatus = "COMPLETED";
        return obj;
      });

      const outputQty = input.outputQuantity ?? input.producedQuantity;
      if (!Number.isFinite(outputQty) || outputQty <= 0) {
        throw AppError.badRequest("Output weight/quantity must be a positive number greater than 0");
      }
      const outputUnit = input.outputUnit || claim.unit || "piece";
      const outputRemark = input.outputRemark || input.delayReason || "";
      const producedQuantity = input.producedQuantity ?? outputQty;
      const usableQuantity = input.usableQuantity ?? outputQty;
      const wastageQuantity = input.wastageQuantity ?? 0;

      const result = await ProductionBatch.findOneAndUpdate(
        {
          _id: claim._id,
          status: S.IN_PRODUCTION,
          completionStatus: "PROCESSING",
        },
        {
          $set: {
            status: S.PACKAGING,
            completionStatus: "DONE",
            packagingStatus: "NOT_STARTED",
            actualOutputQuantity: outputQty,
            actualOutputUnit: outputUnit,
            bakerOutputRemark: outputRemark,
            producedQuantity,
            usableQuantity,
            wastageQuantity,
            bakingEndTime: actualCompletionTime,
            equipmentRuntimeMinutes,
            delayReason: outputRemark || claim.delayReason || "",
            actualCompletionTime,
            productionCompletedBy: user._id,
            assignedWorkers,
            productionNotes: input.productionNotes ?? claim.productionNotes,
          },
        },
        { new: true },
      );
      if (!result)
        throw AppError.conflict(
          "Batch changed while completion was being saved",
        );
      return result;
    } catch (error) {
      await ProductionBatch.updateOne(
        { _id: claim._id, completionStatus: "PROCESSING" },
        { $set: { completionStatus: "NOT_STARTED" } },
      );
      throw error;
    }
  }
  async package(id, input = {}, user) {
    assertId(id);
    const current = await ProductionBatch.findById(id);
    if (!current) throw AppError.notFound("Production batch not found");
    this.assertAssigned(current, user);
    this.assertHoldAllowsTransition(current, "PACKAGE");
    if (current.status !== S.PACKAGING && current.status !== S.QUALITY_CHECK)
      throw AppError.conflict("Only a batch ready for packaging can be packaged");

    const availableOutput = current.actualOutputQuantity ?? current.usableQuantity ?? current.plannedQuantity;
    const baseUnit = current.actualOutputUnit || current.unit || "piece";

    let packagedQuantity = input.packagedQuantity;
    let packages = Array.isArray(input.packages) ? input.packages : [];

    if (packages.length > 0) {
      let totalPackagedInBase = 0;
      packages = packages.map((pkg, idx) => {
        const pkgNum = pkg.packageNumber || idx + 1;
        const qty = Number(pkg.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw AppError.badRequest(`Package #${pkgNum} quantity must be a positive number`);
        }
        const unit = pkg.unit || baseUnit;
        let inBase = qty;
        if (unit !== baseUnit && areUnitsConvertible(unit, baseUnit)) {
          inBase = convertQuantity(qty, unit, baseUnit);
        } else if (unit.toLowerCase() !== baseUnit.toLowerCase()) {
          throw AppError.badRequest(`Package #${pkgNum} unit "${unit}" is incompatible with batch unit "${baseUnit}"`);
        }
        totalPackagedInBase += inBase;
        return {
          packageNumber: pkgNum,
          quantity: qty,
          unit,
          remark: pkg.remark || "",
          orderId: pkg.orderId || null,
          orderNumber: pkg.orderNumber || "",
        };
      });

      if (totalPackagedInBase > availableOutput + 0.0001) {
        throw AppError.badRequest(
          `Total packaged quantity (${totalPackagedInBase} ${baseUnit}) cannot exceed available baking output (${availableOutput} ${baseUnit})`
        );
      }
      packagedQuantity = totalPackagedInBase;
    } else {
      packagedQuantity = input.packagedQuantity ?? current.usableQuantity;
      if (packagedQuantity > availableOutput + 0.0001) {
        throw AppError.badRequest("Packaged quantity cannot exceed usable baking output");
      }
    }

    const claim = await ProductionBatch.findOneAndUpdate(
      {
        _id: id,
        status: { $in: [S.PACKAGING, S.QUALITY_CHECK] },
        packagingStatus: "NOT_STARTED",
      },
      { $set: { packagingStatus: "PROCESSING", status: S.PACKAGING } },
      { new: true },
    );
    if (!claim) throw AppError.conflict("Batch packaging is already in progress or complete");
    let stockUpdated = false;
    const unpackagedQuantity = Math.max(0, Number((availableOutput - packagedQuantity).toFixed(6)));
    const wipDisposition = unpackagedQuantity > 0 ? (input.wipDisposition || "REMAINING_WIP") : "NONE";

    try {
      if (packagedQuantity > 0) {
        const existingStock = await FinishedProductStock.findOne({ product: claim.product, variant: claim.productVariant });
        const stockBefore = existingStock?.onHandQuantity || 0;
        const reservedBefore = existingStock?.reservedQuantity || 0;
        const historyEntry = {
          action: "PRODUCTION_OUTPUT",
          quantity: packagedQuantity,
          previousOnHand: stockBefore,
          newOnHand: stockBefore + packagedQuantity,
          previousReserved: reservedBefore,
          newReserved: reservedBefore,
          referenceType: "PRODUCTION_BATCH",
          referenceId: claim._id,
          note: `Batch ${claim.batchNumber} (${claim.batchType || 'PRODUCTION'}) packaged ${packagedQuantity} ${claim.unit || 'units'}. Remaining WIP: ${unpackagedQuantity} ${claim.unit || 'units'}.`,
          performedBy: user._id,
          timestamp: new Date(),
        };

        try {
          await FinishedProductStock.findOneAndUpdate(
            { product: claim.product, variant: claim.productVariant },
            {
              $inc: { onHandQuantity: packagedQuantity },
              $set: { updatedBy: user._id },
              $push: { history: historyEntry },
              $setOnInsert: { product: claim.product, variant: claim.productVariant, reservedQuantity: 0 },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
        } catch (error) {
          if (error.code !== 11000) throw error;
          await FinishedProductStock.findOneAndUpdate(
            { product: claim.product, variant: claim.productVariant },
            {
              $inc: { onHandQuantity: packagedQuantity },
              $set: { updatedBy: user._id },
              $push: { history: historyEntry },
            },
            { new: true },
          );
        }
        stockUpdated = true;
      }
      const packagedAt = new Date();
      const setFields = {
        status: S.PACKAGED,
        packagingStatus: "DONE",
        packages,
        packagingRemark: input.packagingRemark || "",
        packagedQuantity,
        unpackagedQuantity,
        wipDisposition,
        packagedBy: user._id,
        packagedAt,
      };
      if (Array.isArray(input.packagingMaterialsUsed) && input.packagingMaterialsUsed.length > 0) {
        setFields.packagingMaterialsUsed = input.packagingMaterialsUsed;
      }
      const updated = await ProductionBatch.findOneAndUpdate(
        { _id: id, status: S.PACKAGING, packagingStatus: "PROCESSING" },
        { $set: setFields },
        { new: true },
      );
      if (!updated) throw AppError.conflict("Batch changed while packaging was being saved");
      await costingService.autoFinalizeIfReady(updated._id, user);
      await this.syncRelatedOrdersOnCompletion(updated, user);
      return updated;
    } catch (error) {
      if (stockUpdated) await FinishedProductStock.updateOne({ product: claim.product, variant: claim.productVariant, onHandQuantity: { $gte: packagedQuantity } }, { $inc: { onHandQuantity: -packagedQuantity } });
      await ProductionBatch.updateOne({ _id: id, packagingStatus: "PROCESSING" }, { $set: { packagingStatus: "NOT_STARTED" } });
      throw error;
    }
  }
  async transition(id, next, user, reason) {
    assertId(id);
    if (next !== S.CANCELLED) {
      const existingBatch = await ProductionBatch.findById(id);
      if (existingBatch) {
        this.assertHoldAllowsTransition(existingBatch, next);
      }
    }
    if (next === S.COMPLETED) {
      if (!user) throw AppError.forbidden("An authenticated production actor is required");
      const batch = await ProductionBatch.findById(id);
      if (!batch) throw AppError.notFound("Production batch not found");
      this.assertAssigned(batch, user);

      const hasOutput = (batch.actualOutputQuantity !== undefined && batch.actualOutputQuantity > 0) ||
                        (batch.producedQuantity !== undefined && batch.producedQuantity > 0);
      if (!hasOutput) {
        throw AppError.conflict("Baking output must be recorded before completing the batch");
      }
      const hasPackaging = (batch.packagedQuantity !== undefined && batch.packagedQuantity !== null) ||
                           (batch.packages && batch.packages.length > 0);
      if (!hasPackaging) {
        throw AppError.conflict("Packaging must be recorded before completing the batch");
      }
      const available = batch.actualOutputQuantity ?? batch.usableQuantity ?? batch.plannedQuantity;
      if (batch.packagedQuantity > available + 0.0001) {
        throw AppError.conflict("Packaged quantity cannot exceed available baking output");
      }
      if (batch.consumptionStatus !== "CONSUMED") {
        throw AppError.conflict("Batch inventory must be consumed before completion");
      }
    }
    const allowed = {
      [S.PACKAGED]: S.COMPLETED,
      [S.COMPLETED]: S.DELIVERED,
    };
    const prior = Object.keys(allowed).find((key) => allowed[key] === next);
    const validFrom = next === S.CANCELLED
      ? [S.PLANNED, S.ACCEPTED, S.VERIFIED, S.IN_PRODUCTION, S.QUALITY_CHECK, S.PACKAGING]
      : [prior];
    let update;
    if (next === S.COMPLETED && user) {
      update = { $set: { status: next, completedBy: user._id, completedAt: new Date() } };
    } else if (next === S.CANCELLED) {
      update = {
        $set: {
          status: next,
          cancelledBy: user?._id || null,
          cancelledAt: new Date(),
          cancellationReason: reason || "Batch cancelled by authorized manager",
        },
      };
    } else {
      update = { $set: { status: next } };
    }
    const result = await ProductionBatch.findOneAndUpdate(
      { _id: id, status: { $in: validFrom } },
      update,
      { new: true },
    );
    if (!result) {
      const exists = await ProductionBatch.exists({ _id: id });
      if (!exists) throw AppError.notFound("Production batch not found");
      throw AppError.conflict(
        `Invalid production status transition to ${next}`,
      );
    }
    if (next === S.CANCELLED) {
      if (result.assignedWorkers?.length) {
        await ProductionBatch.updateOne(
          { _id: result._id },
          { $set: { "assignedWorkers.$[].taskStatus": "CANCELLED" } },
        );
      }
      if (result.syncOrderStatus && result.relatedOrders?.length) {
        for (const orderId of result.relatedOrders) {
          const remainingPending = await ProductionBatch.countDocuments({
            _id: { $ne: result._id },
            relatedOrders: orderId,
            status: { $in: [S.PLANNED, S.ACCEPTED, S.VERIFIED, S.IN_PRODUCTION, S.QUALITY_CHECK, S.PACKAGING] },
          });
          if (remainingPending === 0) {
            const ord = await Order.findById(orderId);
            if (ord && [CUSTOMER_ORDER_STATUSES.CONFIRMED, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION].includes(ord.status)) {
              await Order.updateOne(
                { _id: ord._id },
                { $set: { status: CUSTOMER_ORDER_STATUSES.CONFIRMED } },
              );
              if (ord.customer) {
                await notificationService.createSafely({
                  recipient: ord.customer,
                  type: "ORDER_STATUS_CHANGED",
                  title: "Order Production Re-queued",
                  message: `Order ${ord.orderNumber} production was cancelled and returned to confirmed queue.`,
                  relatedEntityType: "ORDER",
                  relatedEntityId: ord._id,
                  dedupeKey: `order:${ord._id}:CANCELLED_REVERT`,
                });
              }
            }
          }
        }
      }
    }
    if (next === S.COMPLETED) {
      await this.syncRelatedOrdersOnCompletion(result, user);

      const supervisors = await User.find({ role: { $in: managers }, isActive: true }).select("_id");
      for (const supervisor of supervisors)
        await notificationService.createSafely({
          recipient: supervisor._id,
          type: "PRODUCTION_COMPLETED",
          title: "Production completed",
          message: `Batch ${result.batchNumber} has completed packaging.`,
          relatedEntityType: "PRODUCTION_BATCH",
          relatedEntityId: result._id,
          dedupeKey: `production-completed:${result._id}:${supervisor._id}`,
        });
      await costingService.autoFinalizeIfReady(result._id, user);
    }
    return result;
  }
  async syncRelatedOrdersOnCompletion(batch, actor) {
    if (!batch?.relatedOrders?.length) return;
    for (const orderId of batch.relatedOrders) {
      const remainingPending = await ProductionBatch.countDocuments({
        relatedOrders: orderId,
        status: { $nin: [S.COMPLETED, S.PACKAGED, S.DELIVERED, S.CANCELLED] },
      });
      if (remainingPending === 0) {
        const ord = await Order.findById(orderId);
        if (
          ord &&
          [CUSTOMER_ORDER_STATUSES.CONFIRMED, CUSTOMER_ORDER_STATUSES.IN_PRODUCTION].includes(ord.status)
        ) {
          await Order.updateOne(
            { _id: ord._id },
            { $set: { status: CUSTOMER_ORDER_STATUSES.READY } },
          );
          if (ord.customer) {
            await notificationService.createSafely({
              recipient: ord.customer,
              type: "ORDER_STATUS_CHANGED",
              title: "Order Ready",
              message: `Order ${ord.orderNumber} is now ready for ${ord.orderType === "PICKUP" ? "pickup" : "delivery"}.`,
              relatedEntityType: "ORDER",
              relatedEntityId: ord._id,
              dedupeKey: `order:${ord._id}:READY`,
            });
          }
        }
      }
    }
  }
  async updateAssignment(id, targetWorkerId, input = {}, actor) {
    assertId(id);
    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");

    if (batch.costing?.status === "FINALIZED") {
      throw AppError.conflict("Cannot modify assignments or hours on a batch whose costs are already finalized");
    }

    if (batch.status === S.CANCELLED || batch.status === "CANCELLED") {
      throw AppError.conflict("Cannot update worker assignment for a cancelled batch");
    }

    const isManagerOrOwner = canManage(actor);
    if (!isManagerOrOwner && input.workerId && String(input.workerId) !== String(actor?._id)) {
      throw AppError.forbidden("Production staff can only update their own assignment");
    }
    const effectiveWorkerId = isManagerOrOwner ? (input.workerId || targetWorkerId) : actor?._id;

    const assignmentIndex = (batch.assignedWorkers || []).findIndex(
      (a) => String(a.worker) === String(effectiveWorkerId)
    );
    if (assignmentIndex === -1) {
      throw AppError.notFound("Assigned worker not found on this production batch");
    }

    if (input.task !== undefined) {
      batch.assignedWorkers[assignmentIndex].task = input.task;
    }
    if (input.actualHours !== undefined) {
      if (!Number.isFinite(input.actualHours) || input.actualHours < 0) {
        throw AppError.badRequest("Actual hours must be a finite non-negative number");
      }
      batch.assignedWorkers[assignmentIndex].actualHours = input.actualHours;
    }
    if (input.taskStatus !== undefined) {
      batch.assignedWorkers[assignmentIndex].taskStatus = input.taskStatus;
    }
    if (input.hourlyRateSnapshot !== undefined) {
      if (!isManagerOrOwner) {
        throw AppError.forbidden("Production staff cannot modify labour rate snapshots");
      }
      if (!Number.isFinite(input.hourlyRateSnapshot) || input.hourlyRateSnapshot < 0) {
        throw AppError.badRequest("Hourly rate snapshot must be a finite non-negative number");
      }
      batch.assignedWorkers[assignmentIndex].hourlyRateSnapshot = input.hourlyRateSnapshot;
    }

    await batch.save();
    if (!canViewCosts(actor)) {
      const sanitized = batch.toObject();
      delete sanitized.costing;
      for (const line of sanitized.consumedIngredients || []) {
        delete line.unitCostSnapshot;
        delete line.purchase;
        delete line.vendor;
        delete line.supplierNameSnapshot;
      }
      return sanitized;
    }
    return batch;
  }

  async reassignBatch(id, input, actor) {
    if (!canManage(actor)) {
      throw AppError.forbidden("Only owner or managers can reassign production batches");
    }
    assertId(id);
    const { newWorkerId, reason } = input || {};
    if (!newWorkerId || !mongoose.isValidObjectId(newWorkerId)) {
      throw AppError.badRequest("A valid new worker ID is required");
    }
    if (!reason || !reason.trim()) {
      throw AppError.badRequest("Reassignment reason is required and cannot be empty");
    }

    const batch = await ProductionBatch.findById(id);
    if (!batch) throw AppError.notFound("Production batch not found");

    // Concurrency / state machine rule: active work cannot be silently reassigned
    if ([S.IN_PRODUCTION, S.QUALITY_CHECK, S.PACKAGING].includes(batch.status)) {
      throw AppError.conflict(
        `Cannot silently reassign an actively running batch (${batch.status}). Active work must be transitioned or stopped first.`,
      );
    }

    if ([S.COMPLETED, S.PACKAGED, S.DELIVERED, S.CANCELLED, S.REJECTED, S.QUALITY_FAILED].includes(batch.status)) {
      throw AppError.conflict(`Cannot reassign a batch with terminal status ${batch.status}`);
    }

    const newWorker = await User.findOne({
      _id: newWorkerId,
      role: USER_ROLES.PRODUCTION_STAFF,
      isActive: true,
    });
    if (!newWorker) {
      throw AppError.badRequest("The selected new worker must be an active production staff member");
    }

    const isAlreadyAssigned = (batch.assignedWorkers || []).some(
      (w) => String(w.worker) === String(newWorkerId),
    );
    if (isAlreadyAssigned) {
      throw AppError.conflict("The selected worker is already assigned to this batch");
    }

    const prevWorkerId = batch.assignedWorkers?.[0]?.worker || null;
    const taskName = batch.assignedWorkers?.[0]?.task || "Production";

    // Record reassignment history
    const record = {
      previousWorker: prevWorkerId || newWorker._id,
      newWorker: newWorker._id,
      reassignedBy: actor._id,
      reason: reason.trim(),
      reassignedAt: new Date(),
    };

    batch.reassignments = [...(batch.reassignments || []), record];
    batch.assignedWorkers = await this.resolveAssignments([
      { worker: newWorker._id, task: taskName },
    ]);
    batch.status = S.PLANNED;
    batch.acceptedPlan = null;
    batch.acceptedBy = null;
    batch.acceptedAt = null;
    await batch.save();

    // Notify new worker
    await notificationService.createSafely({
      recipient: newWorker._id,
      type: "PRODUCTION_ASSIGNED",
      title: "Production Batch Assigned",
      message: `You were assigned to batch ${batch.batchNumber} (${reason.trim()}).`,
      relatedEntityType: "PRODUCTION_BATCH",
      relatedEntityId: batch._id,
      dedupeKey: `production-assigned:${batch._id}:${newWorker._id}:${Date.now()}`,
    });

    // Notify previous worker if existed
    if (prevWorkerId && String(prevWorkerId) !== String(newWorker._id)) {
      await notificationService.createSafely({
        recipient: prevWorkerId,
        type: "PRODUCTION_ASSIGNED",
        title: "Batch Reassigned",
        message: `Batch ${batch.batchNumber} was reassigned to another baker: "${reason.trim()}".`,
        relatedEntityType: "PRODUCTION_BATCH",
        relatedEntityId: batch._id,
        dedupeKey: `production-reassigned:${batch._id}:${prevWorkerId}:${Date.now()}`,
      });
    }

    return batch;
  }

  async getWorkersWorkloadStatus() {
    const workers = await User.find({
      role: USER_ROLES.PRODUCTION_STAFF,
    }).select("name email phone role isActive jobDesignation skills hourlyLabourRate createdAt");

    const nonTerminalStatuses = [
      S.PLANNED,
      S.ACCEPTED,
      S.VERIFIED,
      S.IN_PRODUCTION,
      S.QUALITY_CHECK,
      S.PACKAGING,
    ];

    const activeBatches = await ProductionBatch.find({
      status: { $in: nonTerminalStatuses },
    })
      .populate("product", "name")
      .populate("recipe", "preparationTime productionTime expectedYield estimatedDurationMinutes")
      .populate("relatedOrders", "orderNumber estimatedReadyAt status");

    const now = new Date();

    const workerStatuses = workers.map((worker) => {
      const workerIdStr = String(worker._id);

      if (!worker.isActive) {
        return {
          worker,
          availability: "UNAVAILABLE",
          state: "UNAVAILABLE",
          label: "Offline / Unavailable",
          hasConflict: false,
          conflictWarning: null,
          activeBatch: null,
          activeBatches: [],
          assignedBatches: [],
          totalAssigned: 0,
          recommendationReason: "Worker account is inactive or disabled.",
        };
      }

      // Find actively running batches (IN_PRODUCTION, QUALITY_CHECK, PACKAGING)
      const runningBatches = activeBatches.filter(
        (b) =>
          [S.IN_PRODUCTION, S.QUALITY_CHECK, S.PACKAGING].includes(b.status) &&
          (b.assignedWorkers || []).some((w) => String(w.worker) === workerIdStr),
      );

      // Find assigned but not started batches (PLANNED, ACCEPTED, VERIFIED)
      const assignedNotStarted = activeBatches.filter(
        (b) =>
          [S.PLANNED, S.ACCEPTED, S.VERIFIED].includes(b.status) &&
          (b.assignedWorkers || []).some((w) => String(w.worker) === workerIdStr),
      );

      const formatActiveBatch = (b) => {
        const prep = b.recipe?.preparationTime || 0;
        const prod = b.recipe?.productionTime || 0;
        const recipeEst = b.recipe?.estimatedDurationMinutes || (prep + prod);
        const durationMinutes = b.estimatedDurationMinutes || (recipeEst > 0 ? recipeEst : 45);

        const startTime = b.bakingStartTime || b.actualStartTime || b.createdAt;
        const startDate = new Date(startTime);
        const expectedCompletion = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
        const elapsedMinutes = Math.max(0, Math.round((now.getTime() - startDate.getTime()) / 60000));
        const remainingMinutes = Math.round((expectedCompletion.getTime() - now.getTime()) / 60000);
        const isOverdue = now > expectedCompletion;
        const workerAssignment = (b.assignedWorkers || []).find((w) => String(w.worker) === workerIdStr);

        return {
          _id: b._id,
          batchId: b._id,
          batchNumber: b.batchNumber,
          productName: b.productSnapshot?.productName || b.product?.name || "Product",
          variantName: b.productSnapshot?.variantName || "",
          plannedQuantity: b.plannedQuantity,
          usableQuantity: b.usableQuantity,
          status: b.status,
          stage: b.status,
          task: workerAssignment?.task || (b.status === S.PACKAGING ? "Packaging" : "Baking"),
          taskStatus: workerAssignment?.taskStatus || "IN_PROGRESS",
          startTime: startDate,
          actualStartTime: startDate,
          estimatedDurationMinutes: durationMinutes,
          estimatedRemainingMinutes: remainingMinutes,
          expectedCompletionTime: expectedCompletion,
          isOverdue,
          overdueMinutes: isOverdue ? Math.abs(remainingMinutes) : 0,
          elapsedMinutes,
          relatedOrderNumbers: (b.relatedOrders || []).map((o) => o.orderNumber),
        };
      };

      if (runningBatches.length > 0) {
        const formattedRunningBatches = runningBatches.map(formatActiveBatch);
        const primaryActiveBatch = formattedRunningBatches[0];
        const hasConflict = runningBatches.length > 1;
        const conflictWarning = hasConflict
          ? `Workload Conflict: Baker is assigned to ${runningBatches.length} active batches simultaneously (${runningBatches.map((b) => b.batchNumber).join(", ")}). Concurrency policy strictly limits each staff member to one active batch.`
          : null;

        const isOverdue = primaryActiveBatch.isOverdue;
        const state = hasConflict ? "CONFLICT" : isOverdue ? "OVERDUE" : "BUSY";
        const label = hasConflict ? "Workload Conflict" : isOverdue ? "Overdue" : "Busy";

        return {
          worker,
          availability: "BUSY",
          state,
          label,
          hasConflict,
          conflictWarning,
          activeBatch: primaryActiveBatch,
          activeBatches: formattedRunningBatches,
          assignedBatches: assignedNotStarted.map((b) => ({
            _id: b._id,
            batchId: b._id,
            batchNumber: b.batchNumber,
            productName: b.productSnapshot?.productName || b.product?.name || "Product",
            plannedQuantity: b.plannedQuantity,
            status: b.status,
            stage: b.status,
          })),
          totalAssigned: assignedNotStarted.length,
          recommendationReason: hasConflict
            ? conflictWarning
            : isOverdue
            ? `Currently overdue by ${Math.abs(primaryActiveBatch.estimatedRemainingMinutes)}m on batch ${primaryActiveBatch.batchNumber}. Requires manager attention.`
            : `Currently busy on batch ${primaryActiveBatch.batchNumber} with ~${primaryActiveBatch.estimatedRemainingMinutes}m remaining. Concurrency limits to 1 active batch.`,
        };
      }

      if (assignedNotStarted.length > 0) {
        return {
          worker,
          availability: "AVAILABLE",
          state: "ASSIGNED",
          label: "Available (Queued)",
          hasConflict: false,
          conflictWarning: null,
          activeBatch: null,
          activeBatches: [],
          assignedBatches: assignedNotStarted.map((b) => ({
            _id: b._id,
            batchId: b._id,
            batchNumber: b.batchNumber,
            productName: b.productSnapshot?.productName || b.product?.name || "Product",
            plannedQuantity: b.plannedQuantity,
            status: b.status,
            stage: b.status,
          })),
          totalAssigned: assignedNotStarted.length,
          recommendationReason: `Has ${assignedNotStarted.length} pending assigned batch(es) awaiting kitchen start. Available for queue scheduling.`,
        };
      }

      return {
        worker,
        availability: "AVAILABLE",
        state: "AVAILABLE",
        label: "Available",
        hasConflict: false,
        conflictWarning: null,
        activeBatch: null,
        activeBatches: [],
        assignedBatches: [],
        totalAssigned: 0,
        recommendationReason: "Fully available with 0 active batches and 0 pending assignments.",
      };
    });

    return workerStatuses;
  }

  async recommendWorkers({ orderId, batchId }) {
    let order = null;
    let batch = null;

    if (orderId) {
      assertId(orderId);
      order = await Order.findById(orderId).populate("items.productId", "name");
      if (!order) throw AppError.notFound("Order not found");

      // Payment gate check
      const isPaid = order.paymentStatus === "PAYMENT_CONFIRMED" || (order.paymentMethod === "RAZORPAY" && order.paymentSummary?.status === "CAPTURED");
      if (!isPaid && order.paymentMethod !== "COD") {
        throw AppError.conflict(
          `Payment is not verified for order ${order.orderNumber} (status: ${order.paymentStatus}). Payment must be confirmed before recommending production workers.`,
        );
      }
    }

    if (batchId) {
      assertId(batchId);
      batch = await ProductionBatch.findById(batchId).populate("product", "name");
      if (!batch) throw AppError.notFound("Production batch not found");
    }

    const workerStatuses = await this.getWorkersWorkloadStatus();

    // Filter to eligible staff and rank them
    const scoredWorkers = workerStatuses.map((item) => {
      let score = 0;
      let eligible = true;
      let reason = item.recommendationReason;

      if (item.state === "UNAVAILABLE") {
        eligible = false;
        score = -1000;
      } else if (item.state === "AVAILABLE") {
        score = 100;
        reason = "Recommended because this worker has the required skills, no active batch, and earliest feasible start time.";
      } else if (item.state === "ASSIGNED") {
        score = 80 - item.totalAssigned * 10;
        reason = `Eligible backup: 0 active running batches, ${item.totalAssigned} assigned batch(es) in queue.`;
      } else if (item.state === "BUSY") {
        score = 30 - Math.min(25, item.activeBatch?.estimatedRemainingMinutes || 15);
        reason = `Currently working on batch ${item.activeBatch?.batchNumber} (~${item.activeBatch?.estimatedRemainingMinutes}m remaining). Concurrency limits to 1 active batch.`;
      } else if (item.state === "OVERDUE") {
        score = 10;
        reason = `Currently overdue on batch ${item.activeBatch?.batchNumber}. Should complete or handover before taking new work.`;
      } else if (item.state === "CONFLICT") {
        eligible = false;
        score = -500;
        reason = item.conflictWarning || "Workload conflict detected.";
      }

      return {
        ...item,
        score,
        eligible,
        recommendationReason: reason,
      };
    });

    // Sort by score descending (highest score first)
    scoredWorkers.sort((a, b) => b.score - a.score);

    const eligibleWorkers = scoredWorkers.filter((w) => w.eligible);
    const recommendedWorker = eligibleWorkers.length > 0 ? eligibleWorkers[0] : null;

    return {
      orderId: order?._id || null,
      orderNumber: order?.orderNumber || null,
      batchId: batch?._id || null,
      batchNumber: batch?.batchNumber || null,
      recommendedWorker: recommendedWorker ? {
        _id: recommendedWorker.worker._id,
        name: recommendedWorker.worker.name,
        email: recommendedWorker.worker.email,
        jobDesignation: recommendedWorker.worker.jobDesignation,
        skills: recommendedWorker.worker.skills || [],
        state: recommendedWorker.state,
        reason: recommendedWorker.recommendationReason,
      } : null,
      candidates: scoredWorkers.map((item, idx) => ({
        rank: idx + 1,
        worker: {
          _id: item.worker._id,
          name: item.worker.name,
          email: item.worker.email,
          jobDesignation: item.worker.jobDesignation,
          skills: item.worker.skills || [],
          isActive: item.worker.isActive,
        },
        state: item.state,
        label: item.label,
        activeBatch: item.activeBatch,
        totalAssigned: item.totalAssigned,
        eligible: item.eligible,
        reason: item.recommendationReason,
      })),
    };
  }
}

export const productionService = new ProductionService();
export default productionService;
