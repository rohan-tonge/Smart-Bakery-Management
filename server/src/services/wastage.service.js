import mongoose from "mongoose";
import crypto from "node:crypto";
import ProductionBatch from "../models/productionBatch.model.js";
import WastageRecord from "../models/wastageRecord.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import Ingredient from "../models/ingredient.model.js";
import { inventoryService } from "./inventory.service.js";
import {
  areUnitsConvertible,
  convertQuantity,
} from "../utils/measurement.utils.js";
import { multiplyQuantityByRupees } from "../utils/money.utils.js";
import AppError from "../utils/appError.js";
import { USER_ROLES } from "../utils/constants.js";

const manages = (user) =>
  Boolean(
    user &&
      [
        USER_ROLES.OWNER_MANAGER,
        USER_ROLES.OWNER,
        USER_ROLES.MANAGER,
        "OWNER",
        "MANAGER",
      ].includes(user.role),
  );
const validId = (id, label) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest(`Invalid ${label}`);
};
class WastageService {
  async claimBatchWrite(batchId) {
    const batch = await ProductionBatch.findOneAndUpdate(
      { _id: batchId, "costing.status": "NOT_FINALIZED" },
      { $inc: { wastageWriteCount: 1 } },
      { new: true },
    );
    if (!batch)
      throw AppError.conflict(
        "Wastage cannot be added after cost finalization has started",
      );
    return batch;
  }
  async releaseBatchWrite(batchId) {
    await ProductionBatch.updateOne(
      { _id: batchId, wastageWriteCount: { $gt: 0 } },
      { $inc: { wastageWriteCount: -1 } },
    );
  }
  assertCanRecord(batch, user) {
    if (
      !manages(user) &&
      !batch.assignedWorkers.some(
        (assignment) => String(assignment.worker) === String(user._id),
      )
    )
      throw AppError.forbidden(
        "You can only record wastage for batches assigned to you",
      );
  }
  async create(input, user) {
    validId(input.productionBatch, "production batch ID");
    const batch = await ProductionBatch.findById(input.productionBatch);
    if (!batch) throw AppError.notFound("Production batch not found");
    this.assertCanRecord(batch, user);
    if (
      batch.costing.status === "FINALIZING" ||
      batch.costing.status === "FINALIZED"
    )
      throw AppError.conflict(
        "Wastage cannot be added after cost finalization has started",
      );
    const fingerprint = input.idempotencyKey
      ? crypto
          .createHash("sha256")
          .update(
            JSON.stringify({
              productionBatch: input.productionBatch,
              type: input.type,
              ingredient: input.ingredient,
              inventoryLot: input.inventoryLot,
              quantity: input.quantity,
              unit: input.unit,
              reason: input.reason,
              notes: input.notes || "",
            }),
          )
          .digest("hex")
      : "";
    if (input.type !== "PRODUCTION_OUTPUT" && input.idempotencyKey) {
      const prior = await WastageRecord.findOne({
        recordedBy: user._id,
        idempotencyKey: input.idempotencyKey,
      });
      if (prior) {
        if (prior.requestFingerprint !== fingerprint)
          throw AppError.conflict(
            "Idempotency key was already used with a different wastage request",
          );
        if (prior.status === "RECORDED") return prior;
        throw AppError.conflict(
          "Wastage request with this idempotency key is still processing",
        );
      }
    }
    if (input.type === "PRODUCTION_OUTPUT") {
      if (
        !["QUALITY_CHECK", "QUALITY_FAILED", "PACKAGING", "PACKAGED", "COMPLETED", "DELIVERED"].includes(batch.status) ||
        batch.wastageQuantity <= 0 ||
        input.quantity !== batch.wastageQuantity ||
        input.unit !== batch.unit
      )
        throw AppError.badRequest(
          "Output wastage must match the completed batch wastage quantity and unit",
        );
      const claimedBatch = await this.claimBatchWrite(batch._id);
      try {
        return await WastageRecord.create({
          productionBatch: claimedBatch._id,
          product: claimedBatch.product,
          productVariant: claimedBatch.productVariant,
          productSnapshot: {
            productName: claimedBatch.productSnapshot.productName,
            variantName: claimedBatch.productSnapshot.variantName,
          },
          quantity: input.quantity,
          unit: input.unit,
          type: input.type,
          reason: input.reason,
          notes: input.notes || "",
          valuePaise: 0,
          valueBasis: "NOT_VALUED",
          status: "RECORDED",
          recordedBy: user._id,
        });
      } catch (error) {
        if (error.code === 11000)
          throw AppError.conflict(
            "Output wastage is already recorded for this batch",
          );
        throw error;
      } finally {
        await this.releaseBatchWrite(batch._id);
      }
    }
    if (!["IN_PRODUCTION", "QUALITY_CHECK", "QUALITY_FAILED", "PACKAGING", "PACKAGED", "COMPLETED", "DELIVERED"].includes(batch.status))
      throw AppError.conflict(
        "Wastage can only be recorded against an active or completed batch",
      );
    let ingredient = null;
    let lot = null;
    let transactionId = null;
    if (input.type === "RAW_MATERIAL") {
      if (batch.status !== "IN_PRODUCTION")
        throw AppError.conflict(
          "Raw-material wastage can only be recorded during production",
        );
      validId(input.ingredient, "ingredient ID");
      validId(input.inventoryLot, "inventory lot ID");
      lot = await InventoryLot.findOne({
        _id: input.inventoryLot,
        ingredient: input.ingredient,
      });
      ingredient = await Ingredient.findById(input.ingredient);
      if (
        !lot ||
        !ingredient ||
        !areUnitsConvertible(input.unit, lot.unit) ||
        !areUnitsConvertible(input.unit, ingredient.unit)
      )
        throw AppError.badRequest(
          "Raw-material wastage must reference a valid compatible ingredient and lot",
        );
      await lot.populate("vendor", "name");
      if (
        !batch.recipeSnapshot.ingredients.some(
          (item) => String(item.ingredient) === String(ingredient._id),
        )
      )
        throw AppError.badRequest(
          "Ingredient is not part of this batch recipe",
        );
      if (!input.idempotencyKey)
        throw AppError.badRequest(
          "Raw-material wastage requires an idempotencyKey",
        );
    }
    await this.claimBatchWrite(batch._id);
    const requestFingerprint = fingerprint;
    let record;
    try {
      record = await WastageRecord.create({
        productionBatch: batch._id,
        product: batch.product,
        productVariant: batch.productVariant,
        productSnapshot: {
          productName: batch.productSnapshot.productName,
          variantName: batch.productSnapshot.variantName,
        },
        ...(ingredient
          ? {
              ingredient: ingredient._id,
              ingredientNameSnapshot: ingredient.name,
            }
          : {}),
        ...(lot
          ? {
              inventoryLot: lot._id,
              lotNumberSnapshot: lot.lotNumber,
              purchase: lot.purchase || null,
              vendor: lot.vendor?._id || lot.vendor || null,
              supplierNameSnapshot: lot.vendor?.name || "",
            }
          : {}),
        quantity: input.quantity,
        unit: input.unit,
        type: input.type,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        notes: input.notes || "",
        recordedBy: user._id,
      });
    } catch (error) {
      await this.releaseBatchWrite(batch._id);
      if (error.code === 11000)
        throw AppError.conflict("Duplicate wastage record");
      throw error;
    }
    if (input.type === "RAW_MATERIAL") {
      let inventoryResult;
      try {
        inventoryResult = await inventoryService.recordRawMaterialWastage({
          record,
          performedBy: user._id,
        });
        transactionId = inventoryResult.transactionId;
        const quantity = inventoryResult.quantity;
        const valuePaise = multiplyQuantityByRupees(quantity, lot.unitCost);
        record.quantity = quantity;
        record.unit = inventoryResult.unit;
        record.inventoryTransaction = transactionId;
        record.valuePaise = valuePaise;
        record.valueBasis = "LOT_COST";
        record.status = "RECORDED";
        await record.save();
      } catch (error) {
        if (inventoryResult)
          await inventoryService.rollbackRawMaterialWastage({
            result: inventoryResult,
          });
        await WastageRecord.deleteOne({ _id: record._id });
        await this.releaseBatchWrite(batch._id);
        throw error;
      }
    } else {
      record.status = "RECORDED";
      try {
        await record.save();
      } catch (error) {
        await WastageRecord.deleteOne({ _id: record._id });
        await this.releaseBatchWrite(batch._id);
        throw error;
      }
    }
    await this.releaseBatchWrite(batch._id);
    return record;
  }
  async list({ page = 1, limit = 20, type, from, to }, user) {
    const filter = {
      ...(type ? { type } : {}),
      ...(!manages(user) ? { recordedBy: user._id } : {}),
      ...(from || to
        ? {
            recordedAt: {
              ...(from ? { $gte: from } : {}),
              ...(to ? { $lte: to } : {}),
            },
          }
        : {}),
    };
    const [records, total] = await Promise.all([
      WastageRecord.find(filter)
        .sort({ recordedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("productionBatch", "batchNumber status")
        .populate("ingredient", "name unit")
        .populate("inventoryLot", "lotNumber purchase vendor"),
      WastageRecord.countDocuments(filter),
    ]);
    return {
      records,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
  async get(id, user) {
    validId(id, "wastage record ID");
    const record = await WastageRecord.findById(id)
      .populate(
        "productionBatch",
        "batchNumber status assignedWorkers relatedOrders",
      )
      .populate("ingredient", "name unit")
      .populate("inventoryLot", "lotNumber purchase vendor")
      .populate("inventoryTransaction");
    if (!record) throw AppError.notFound("Wastage record not found");
    if (
      !manages(user) &&
      (String(record.recordedBy) !== String(user._id) ||
        !record.productionBatch.assignedWorkers.some(
          (item) => String(item.worker) === String(user._id),
        ))
    )
      throw AppError.notFound("Wastage record not found");
    return record;
  }
  async summary({ from, to }) {
    const filter = {
      status: "RECORDED",
      ...(from || to
        ? {
            recordedAt: {
              ...(from ? { $gte: from } : {}),
              ...(to ? { $lte: to } : {}),
            },
          }
        : {}),
    };
    const rows = await WastageRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$type",
          records: { $sum: 1 },
          quantity: { $sum: "$quantity" },
          valuePaise: { $sum: "$valuePaise" },
        },
      },
    ]);
    return rows.map((row) => ({
      type: row._id,
      records: row.records,
      quantity: row.quantity,
      value: row.valuePaise / 100,
    }));
  }
}
export const wastageService = new WastageService();
export default wastageService;
