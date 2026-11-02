import mongoose from "mongoose";
import IngredientRequisition, {
  REQUISITION_STATUS as RS,
} from "../models/ingredientRequisition.model.js";
import RequisitionCounter from "../models/requisitionCounter.model.js";
import ProductionBatch from "../models/productionBatch.model.js";
import Recipe from "../models/recipe.model.js";
import Ingredient from "../models/ingredient.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import InventoryTransaction from "../models/inventoryTransaction.model.js";
import User from "../models/user.model.js";
import AppError from "../utils/appError.js";
import {
  INVENTORY_TRANSACTION_TYPES,
  PRODUCTION_STATUS as S,
  USER_ROLES,
} from "../utils/constants.js";
import {
  areUnitsConvertible,
  convertQuantity,
  roundQuantity,
} from "../utils/measurement.utils.js";
import { notificationService } from "./notification.service.js";

const managers = [
  USER_ROLES.OWNER_MANAGER,
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
  "OWNER",
  "MANAGER",
];

const canManage = (user) => Boolean(user && managers.includes(user.role));

const expiryFilter = (now = new Date()) => ({
  $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
});

const availableFilter = (ingredientId, now = new Date()) => ({
  ingredient: ingredientId,
  status: "AVAILABLE",
  remainingQuantity: { $gt: 0 },
  ...expiryFilter(now),
});

class RequisitionService {
  async nextRequisitionNumber() {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const key = `REQ-${date}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const counter = await RequisitionCounter.findOneAndUpdate(
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

  async notifyManagers(type, title, message, requisition, customDedupeKey = null) {
    const supervisors = await User.find({
      role: { $in: managers },
      isActive: true,
    }).select("_id name email role");

    const itemsSummary = (requisition.items || []).map((it) => ({
      name: it.name,
      requestedQuantity: it.requestedQuantity,
      approvedQuantity: it.approvedQuantity,
      issuedQuantity: it.issuedQuantity,
      unit: it.unit,
    }));

    const dedupe = customDedupeKey || `req-${type.toLowerCase()}:${requisition._id}`;

    for (const supervisor of supervisors) {
      await notificationService.createSafely({
        recipient: supervisor._id,
        type,
        title,
        message,
        relatedEntityType: "INGREDIENT_REQUISITION",
        relatedEntityId: requisition._id,
        metadata: {
          requisitionId: requisition._id,
          requisitionNumber: requisition.requisitionNumber,
          batchId: requisition.batch,
          batchNumber: requisition.batchNumber,
          requesterName: requisition.requesterName,
          requesterId: requisition.requester,
          status: requisition.status,
          requestedAt: requisition.requestedAt || requisition.createdAt,
          items: itemsSummary,
        },
        dedupeKey: dedupe,
      });
    }
  }

  async calculateBatchRequirements(batch, user) {
    if (!batch) throw AppError.notFound("Production batch not found");

    const recipe = await Recipe.findOne({
      product: batch.product,
      variant: batch.productVariant,
      isActive: true,
    }).populate("ingredients.ingredient", "name unit isActive minimumStock reservedStock productionReservedStock");

    if (!recipe) {
      throw AppError.badRequest(
        `Active recipe for ${batch.productSnapshot?.productName || "product"} is missing or inactive.`,
      );
    }

    const prep = recipe.preparationTime || 0;
    const prod = recipe.productionTime || 0;
    const totalDuration = prep + prod;
    if (totalDuration <= 0) {
      throw AppError.badRequest(
        `Recipe for ${batch.productSnapshot?.productName || "product"} must define a positive preparation or production duration in minutes.`,
      );
    }

    const recipeBatchQuantity = batch.plannedQuantity / recipe.expectedYield;
    const isStaff = !canManage(user);

    // Aggregate requirements safely, grouping by ingredient ID and normalized unit
    const requirementsMap = new Map();

    for (const line of recipe.ingredients) {
      const ing = line.ingredient;
      if (!ing || !ing.isActive) {
        throw AppError.badRequest(
          `Recipe requires inactive or deleted ingredient "${line.name || line.ingredient}".`,
        );
      }
      if (!areUnitsConvertible(line.unit, ing.unit)) {
        throw AppError.badRequest(
          `Unit "${line.unit}" in recipe is incompatible with ingredient "${ing.name}" base unit "${ing.unit}".`,
        );
      }

      // Convert recipe quantity to ingredient base unit
      const normalizedQuantity = roundQuantity(
        convertQuantity(line.quantity * recipeBatchQuantity, line.unit, ing.unit),
      );

      const ingKey = ing._id.toString();
      if (requirementsMap.has(ingKey)) {
        const existing = requirementsMap.get(ingKey);
        existing.requiredQuantity = roundQuantity(existing.requiredQuantity + normalizedQuantity);
      } else {
        requirementsMap.set(ingKey, {
          ingredientId: ing._id,
          name: ing.name,
          requiredQuantity: normalizedQuantity,
          unit: ing.unit,
          recipeUnit: line.unit,
        });
      }
    }

    // Gathers operational stock information without revealing purchase costs/prices
    const items = [];
    for (const req of requirementsMap.values()) {
      const availableLots = await InventoryLot.aggregate([
        { $match: availableFilter(req.ingredientId) },
        {
          $group: {
            _id: null,
            totalRemaining: { $sum: "$remainingQuantity" },
          },
        },
      ]);
      const currentStock = roundQuantity(availableLots[0]?.totalRemaining || 0);

      const ingDoc = await Ingredient.findById(req.ingredientId).select(
        "reservedStock productionReservedStock minimumStock",
      );
      const allocated = roundQuantity(
        (ingDoc?.reservedStock || 0) + (ingDoc?.productionReservedStock || 0),
      );
      const available = Math.max(0, roundQuantity(currentStock - allocated));
      const shortage = Math.max(0, roundQuantity(req.requiredQuantity - available));

      items.push({
        ingredientId: req.ingredientId,
        name: req.name,
        requiredQuantity: req.requiredQuantity,
        unit: req.unit,
        availableStock: available,
        currentStock,
        allocatedStock: allocated,
        shortage,
        status: shortage > 0.000001 ? "INSUFFICIENT" : "SUFFICIENT",
      });
    }

    return {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      productName: batch.productSnapshot?.productName || "Product",
      variantName: batch.productSnapshot?.variantName || "Standard",
      plannedQuantity: batch.plannedQuantity,
      preparationTime: prep,
      productionTime: prod,
      totalDuration,
      recipeYield: recipe.expectedYield,
      recipeBatchMultiplier: recipeBatchQuantity,
      ingredients: items,
      equipment: [
        "Commercial Baking Oven",
        "Digital Weighing Scale",
        "Mixing Station & Utensils",
        "Baking Trays & Parchment Paper",
      ],
      instructions: recipe.instructions || "",
    };
  }

  async getBatchRequirements(batchId, user) {
    if (!mongoose.isValidObjectId(batchId)) {
      throw AppError.badRequest("Invalid batch ID");
    }
    const batch = await ProductionBatch.findById(batchId);
    if (!batch) throw AppError.notFound("Production batch not found");

    if (!canManage(user)) {
      const isAssigned = batch.assignedWorkers?.some(
        (w) => String(w.worker) === String(user._id),
      );
      if (!isAssigned) {
        throw AppError.forbidden("You can only inspect required ingredients for batches assigned to you");
      }
    }

    return this.calculateBatchRequirements(batch, user);
  }

  async createRequisition(batchId, input, user) {
    if (!mongoose.isValidObjectId(batchId)) {
      throw AppError.badRequest("Invalid batch ID");
    }
    const batch = await ProductionBatch.findById(batchId);
    if (!batch) throw AppError.notFound("Production batch not found");

    // Only assigned staff or manager can create requisition
    if (!canManage(user)) {
      const isAssigned = batch.assignedWorkers?.some(
        (w) => String(w.worker) === String(user._id),
      );
      if (!isAssigned) {
        throw AppError.forbidden("You can only request ingredients for batches assigned to you");
      }
    }

    // Staff must accept batch before requesting ingredients
    if (batch.status === S.PLANNED) {
      throw AppError.conflict(
        "You must accept the production batch assignment before requesting ingredients",
      );
    }
    if ([S.CANCELLED, S.REJECTED, S.COMPLETED, S.PACKAGED, S.DELIVERED].includes(batch.status)) {
      throw AppError.conflict(`Cannot request ingredients for a batch with status ${batch.status}`);
    }

    // Check for existing pending or approved requisition
    const existingActiveReq = await IngredientRequisition.findOne({
      batch: batch._id,
      status: { $in: [RS.PENDING, RS.APPROVED, RS.ISSUED] },
    });
    if (existingActiveReq) {
      if (existingActiveReq.status === RS.ISSUED) {
        throw AppError.conflict(
          `Ingredients for batch ${batch.batchNumber} have already been issued under ${existingActiveReq.requisitionNumber}`,
        );
      }
      throw AppError.conflict(
        `An active requisition (${existingActiveReq.requisitionNumber}) already exists for this batch with status ${existingActiveReq.status}`,
      );
    }

    // Calculate recipe requirements to validate requested quantities
    const requirements = await this.calculateBatchRequirements(batch, user);
    const reqMap = new Map(
      requirements.ingredients.map((item) => [String(item.ingredientId), item]),
    );

    const itemsToSave = [];
    const submittedItems = input.items || [];

    if (!submittedItems.length) {
      // If staff submitted empty items, default to the recipe requirements
      for (const req of requirements.ingredients) {
        itemsToSave.push({
          ingredient: req.ingredientId,
          name: req.name,
          requiredQuantity: req.requiredQuantity,
          requestedQuantity: req.requiredQuantity,
          unit: req.unit,
          adjustmentReason: "",
          issuedLots: [],
        });
      }
    } else {
      for (const item of submittedItems) {
        const ingId = String(item.ingredient || item.ingredientId);
        const req = reqMap.get(ingId);
        if (!req) {
          throw AppError.badRequest(
            `Ingredient ${item.name || ingId} is not part of the active recipe for this batch`,
          );
        }
        const requestedQuantity = Number(item.requestedQuantity);
        if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
          throw AppError.badRequest(`Requested quantity for ${req.name} must be a positive number`);
        }

        // Prevent excessive request (> 150% of required without manager override)
        if (requestedQuantity > req.requiredQuantity * 1.5 && !input.adjustmentReason) {
          throw AppError.badRequest(
            `Requested quantity (${requestedQuantity} ${req.unit}) for ${req.name} exceeds recipe requirement (${req.requiredQuantity} ${req.unit}) by more than 50%. Provide an explanation in notes.`,
          );
        }

        itemsToSave.push({
          ingredient: req.ingredientId,
          name: req.name,
          requiredQuantity: req.requiredQuantity,
          requestedQuantity,
          unit: req.unit,
          adjustmentReason: item.adjustmentReason || input.adjustmentReason || "",
          issuedLots: [],
        });
      }

      // Ensure all recipe ingredients are represented
      for (const req of requirements.ingredients) {
        const found = itemsToSave.some((it) => String(it.ingredient) === String(req.ingredientId));
        if (!found) {
          itemsToSave.push({
            ingredient: req.ingredientId,
            name: req.name,
            requiredQuantity: req.requiredQuantity,
            requestedQuantity: req.requiredQuantity,
            unit: req.unit,
            adjustmentReason: "",
            issuedLots: [],
          });
        }
      }
    }

    const requisitionNumber = await this.nextRequisitionNumber();
    const requisition = await IngredientRequisition.create({
      requisitionNumber,
      batch: batch._id,
      batchNumber: batch.batchNumber,
      product: batch.product,
      productName: batch.productSnapshot?.productName || "Product",
      productVariant: batch.productVariant,
      variantName: batch.productSnapshot?.variantName || "Standard",
      relatedOrders: batch.relatedOrders || [],
      requester: user._id,
      requesterName: user.name || "Production Staff",
      items: itemsToSave,
      status: RS.PENDING,
      notes: input.notes || "",
      requestedAt: new Date(),
    });

    // Notify managers of new requisition requiring review with rich item details
    const itemsText = (requisition.items || [])
      .map((it) => `${it.name} (${it.requestedQuantity} ${it.unit})`)
      .join(", ");
    const submissionTime = new Date(requisition.requestedAt || Date.now()).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    await this.notifyManagers(
      "REQUISITION_CREATED",
      "New Inventory Request",
      `Requisition ${requisitionNumber} submitted by ${user.name} for batch ${batch.batchNumber}: ${itemsText}. Status: ${requisition.status}. Submitted at ${submissionTime}.`,
      requisition,
      `req-created:${requisition._id}`,
    );

    return requisition;
  }

  async listRequisitions({ page = 1, limit = 20, status, batchId }, user) {
    const filter = {};
    if (status) filter.status = status;
    if (batchId && mongoose.isValidObjectId(batchId)) filter.batch = batchId;

    if (!canManage(user)) {
      // Production staff only sees their own or assigned batch requisitions
      const myBatches = await ProductionBatch.find({
        "assignedWorkers.worker": user._id,
      }).select("_id");
      filter.$or = [
        { requester: user._id },
        { batch: { $in: myBatches.map((b) => b._id) } },
      ];
    }

    const [requisitions, total] = await Promise.all([
      IngredientRequisition.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("requester", "name email jobDesignation")
        .populate("approvedBy", "name email")
        .populate("issuedBy", "name email"),
      IngredientRequisition.countDocuments(filter),
    ]);

    return {
      requisitions,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getRequisition(id, user) {
    if (!mongoose.isValidObjectId(id)) throw AppError.badRequest("Invalid requisition ID");
    const requisition = await IngredientRequisition.findById(id)
      .populate("requester", "name email jobDesignation")
      .populate("approvedBy", "name email")
      .populate("issuedBy", "name email")
      .populate("batch", "batchNumber plannedQuantity status timeSlot");

    if (!requisition) throw AppError.notFound("Requisition not found");

    if (!canManage(user)) {
      const isRequester = String(requisition.requester?._id || requisition.requester) === String(user._id);
      if (!isRequester) {
        const batch = await ProductionBatch.findById(requisition.batch);
        const isAssigned = batch?.assignedWorkers?.some(
          (w) => String(w.worker) === String(user._id),
        );
        if (!isAssigned) {
          throw AppError.forbidden("Access denied to this requisition");
        }
      }
    }

    return requisition;
  }

  async approveRequisition(id, input = {}, managerUser) {
    if (!canManage(managerUser)) {
      throw AppError.forbidden("Only owner or managers can approve ingredient requisitions");
    }
    if (!mongoose.isValidObjectId(id)) throw AppError.badRequest("Invalid requisition ID");

    const requisition = await IngredientRequisition.findById(id);
    if (!requisition) throw AppError.notFound("Requisition not found");

    // Staff cannot approve their own request
    if (String(requisition.requester) === String(managerUser._id)) {
      throw AppError.forbidden("You cannot approve your own ingredient requisition");
    }

    if (requisition.status !== RS.PENDING) {
      throw AppError.conflict(
        `Cannot approve requisition with status ${requisition.status}`,
      );
    }

    // Validate available stock for each approved item
    const adjustedItems = input.items || [];
    const itemMap = new Map(
      adjustedItems.map((it) => [String(it.ingredient || it.ingredientId), it]),
    );

    for (const item of requisition.items) {
      const ingIdStr = String(item.ingredient);
      const adjustment = itemMap.get(ingIdStr);
      let approvedQty = item.requestedQuantity;

      if (adjustment && Number.isFinite(Number(adjustment.approvedQuantity))) {
        approvedQty = Number(adjustment.approvedQuantity);
        item.adjustmentReason = adjustment.adjustmentReason || input.adjustmentReason || "Adjusted by manager";
      }

      if (approvedQty < 0) {
        throw AppError.badRequest(`Approved quantity for ${item.name} cannot be negative`);
      }

      // Check available stock
      const availableLots = await InventoryLot.aggregate([
        { $match: availableFilter(item.ingredient) },
        { $group: { _id: null, total: { $sum: "$remainingQuantity" } } },
      ]);
      const currentStock = roundQuantity(availableLots[0]?.total || 0);

      const ingDoc = await Ingredient.findById(item.ingredient).select(
        "reservedStock productionReservedStock minimumStock",
      );
      const allocated = roundQuantity(
        (ingDoc?.reservedStock || 0) + (ingDoc?.productionReservedStock || 0),
      );
      const available = Math.max(0, roundQuantity(currentStock - allocated));

      if (approvedQty > available) {
        throw AppError.conflict(
          `Cannot approve ${approvedQty} ${item.unit} for ${item.name}; available unallocated stock is only ${available} ${item.unit}.`,
        );
      }

      item.approvedQuantity = approvedQty;
    }

    requisition.status = RS.APPROVED;
    requisition.approvedBy = managerUser._id;
    requisition.approvedAt = new Date();
    requisition.approvalNotes = input.notes || "";
    await requisition.save();

    // Notify requester
    const approvedItemsSummary = (requisition.items || [])
      .map((it) => `${it.name}: ${it.approvedQuantity ?? it.requestedQuantity} ${it.unit}`)
      .join(", ");

    await notificationService.createSafely({
      recipient: requisition.requester,
      type: "REQUISITION_APPROVED",
      title: "Inventory Request Approved",
      message: `Your inventory request ${requisition.requisitionNumber} for batch ${requisition.batchNumber} has been approved (${approvedItemsSummary}). Awaiting physical issuance by manager.`,
      relatedEntityType: "INGREDIENT_REQUISITION",
      relatedEntityId: requisition._id,
      metadata: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        batchId: requisition.batch,
        batchNumber: requisition.batchNumber,
        status: requisition.status,
        approvedBy: managerUser.name || "Store Manager",
        approvedAt: requisition.approvedAt,
      },
      dedupeKey: `req-approved:${requisition._id}`,
    });

    return requisition;
  }

  async rejectRequisition(id, input, managerUser) {
    if (!canManage(managerUser)) {
      throw AppError.forbidden("Only owner or managers can reject ingredient requisitions");
    }
    if (!mongoose.isValidObjectId(id)) throw AppError.badRequest("Invalid requisition ID");
    if (!input.reason?.trim()) {
      throw AppError.badRequest("Provide a clear reason for rejecting the requisition");
    }

    const requisition = await IngredientRequisition.findById(id);
    if (!requisition) throw AppError.notFound("Requisition not found");

    if (![RS.PENDING, RS.APPROVED].includes(requisition.status)) {
      throw AppError.conflict(
        `Cannot reject requisition with status ${requisition.status}`,
      );
    }

    requisition.status = RS.REJECTED;
    requisition.rejectionReason = input.reason.trim();
    requisition.approvedBy = null;
    requisition.approvedAt = null;
    await requisition.save();

    // Notify requester
    await notificationService.createSafely({
      recipient: requisition.requester,
      type: "REQUISITION_REJECTED",
      title: "Inventory Request Rejected",
      message: `Your inventory request ${requisition.requisitionNumber} for batch ${requisition.batchNumber} was rejected: "${input.reason.trim()}". Please review and adjust.`,
      relatedEntityType: "INGREDIENT_REQUISITION",
      relatedEntityId: requisition._id,
      metadata: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        batchId: requisition.batch,
        batchNumber: requisition.batchNumber,
        status: requisition.status,
        rejectionReason: input.reason.trim(),
        rejectedBy: managerUser.name || "Store Manager",
      },
      dedupeKey: `req-rejected:${requisition._id}`,
    });

    return requisition;
  }

  async issueIngredients(id, input = {}, managerUser) {
    if (!canManage(managerUser)) {
      throw AppError.forbidden("Only owner or managers can issue ingredients");
    }
    if (!mongoose.isValidObjectId(id)) throw AppError.badRequest("Invalid requisition ID");

    const requisition = await IngredientRequisition.findById(id);
    if (!requisition) throw AppError.notFound("Requisition not found");

    // Staff cannot issue their own request
    if (String(requisition.requester) === String(managerUser._id)) {
      throw AppError.forbidden("Staff cannot issue their own ingredient requisition");
    }

    // Idempotency: if already ISSUED, return existing
    if (requisition.status === RS.ISSUED) {
      return requisition;
    }

    if (![RS.PENDING, RS.APPROVED].includes(requisition.status)) {
      throw AppError.conflict(
        `Cannot issue ingredients for requisition with status ${requisition.status}`,
      );
    }

    const batch = await ProductionBatch.findById(requisition.batch);
    if (!batch) throw AppError.notFound("Associated production batch not found");

    // Execute FIFO lot deduction for each approved/requested quantity
    const changedLots = [];
    const transactionIds = [];
    const batchConsumedLines = [];

    for (const item of requisition.items) {
      const quantityToIssue = item.approvedQuantity ?? item.requestedQuantity;
      if (quantityToIssue <= 0) continue;

      const ingredient = await Ingredient.findById(item.ingredient);
      if (!ingredient || !ingredient.isActive) {
        throw AppError.conflict(`Ingredient "${item.name}" is inactive or deleted`);
      }

      // Find available lots ordered by FEFO / FIFO
      const lots = await InventoryLot.aggregate([
        { $match: availableFilter(ingredient._id) },
        {
          $addFields: {
            fefoExpiry: {
              $ifNull: ["$expiryDate", new Date("9999-12-31T23:59:59.999Z")],
            },
          },
        },
        { $sort: { fefoExpiry: 1, createdAt: 1, _id: 1 } },
      ]);

      let remaining = quantityToIssue;
      const itemIssuedLots = [];

      for (const lot of lots) {
        if (remaining <= 0.000001) break;
        if (!areUnitsConvertible(lot.unit, item.unit)) {
          throw AppError.internal(
            `Inventory lot ${lot.lotNumber} has incompatible unit ${lot.unit}`,
          );
        }

        const lotAvailableInItemUnit = convertQuantity(
          lot.remainingQuantity,
          lot.unit,
          item.unit,
        );
        const takeInItemUnit = Math.min(lotAvailableInItemUnit, remaining);
        const takeInLotUnit = convertQuantity(takeInItemUnit, item.unit, lot.unit);

        const nextLotQuantity = roundQuantity(lot.remainingQuantity - takeInLotUnit);

        const updateRes = await InventoryLot.updateOne(
          {
            _id: lot._id,
            status: "AVAILABLE",
            remainingQuantity: lot.remainingQuantity,
          },
          {
            $set: {
              remainingQuantity: nextLotQuantity,
              ...(nextLotQuantity <= 0 ? { status: "DEPLETED" } : {}),
            },
          },
        );

        if (!updateRes.modifiedCount) {
          throw AppError.conflict(
            `Stock for lot ${lot.lotNumber} changed during issuance; retry`,
          );
        }

        changedLots.push({ lot, nextLotQuantity });

        const [transaction] = await InventoryTransaction.create([
          {
            ingredient: ingredient._id,
            lot: lot._id,
            type: INVENTORY_TRANSACTION_TYPES.CONSUMPTION,
            quantity: takeInLotUnit,
            unit: lot.unit,
            direction: "OUT",
            referenceType: "PRODUCTION",
            referenceId: batch._id,
            reason: `Requisition ${requisition.requisitionNumber} for batch ${batch.batchNumber}`,
            performedBy: managerUser._id,
          },
        ]);
        transactionIds.push(transaction._id);

        itemIssuedLots.push({
          lot: lot._id,
          lotNumber: lot.lotNumber,
          quantity: takeInLotUnit,
          unit: lot.unit,
          transactionId: transaction._id,
        });

        batchConsumedLines.push({
          ingredient: ingredient._id,
          ingredientName: ingredient.name,
          lot: lot._id,
          lotNumber: lot.lotNumber,
          purchase: lot.purchase || null,
          vendor: lot.vendor || null,
          supplierNameSnapshot: "",
          quantity: takeInLotUnit,
          unit: lot.unit,
          unitCostSnapshot: lot.unitCost || 0,
        });

        remaining = roundQuantity(remaining - takeInItemUnit);
      }

      if (remaining > 0.000001) {
        throw AppError.conflict(
          `Insufficient stock to issue full quantity for ${item.name}. Missing: ${remaining} ${item.unit}.`,
        );
      }

      item.issuedQuantity = quantityToIssue;
      item.issuedLots = itemIssuedLots;
    }

    requisition.status = RS.ISSUED;
    requisition.issuedBy = managerUser._id;
    requisition.issuedAt = new Date();
    await requisition.save();

    // Update batch to VERIFIED and CONSUMED so production staff can start baking
    await ProductionBatch.updateOne(
      { _id: batch._id },
      {
        $set: {
          status: S.VERIFIED,
          verificationStatus: "VERIFIED",
          consumptionStatus: "CONSUMED",
          verifiedBy: managerUser._id,
          verifiedAt: new Date(),
          actualStartTime: batch.actualStartTime || new Date(),
          consumedIngredients: batchConsumedLines,
        },
      },
    );

    // Notify requester and assigned staff
    const recipientIds = new Set([
      String(requisition.requester),
      ...(batch.assignedWorkers || []).map((w) => String(w.worker)),
    ]);
    for (const workerId of recipientIds) {
      await notificationService.createSafely({
        recipient: workerId,
        type: "REQUISITION_ISSUED",
        title: "Inventory Issued",
        message: `Ingredients for batch ${batch.batchNumber} (${requisition.requisitionNumber}) have been issued by manager. Stock deducted from pantry; baking may now start.`,
        relatedEntityType: "INGREDIENT_REQUISITION",
        relatedEntityId: requisition._id,
        metadata: {
          requisitionId: requisition._id,
          requisitionNumber: requisition.requisitionNumber,
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          status: requisition.status,
          issuedBy: managerUser.name || "Store Manager",
          issuedAt: requisition.issuedAt,
        },
        dedupeKey: `req-issued:${requisition._id}:${workerId}`,
      });
    }

    return requisition;
  }
}

export const requisitionService = new RequisitionService();
export default requisitionService;
