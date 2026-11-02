import mongoose from "mongoose";
import Ingredient from "../models/ingredient.model.js";
import Vendor from "../models/vendor.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import InventoryTransaction from "../models/inventoryTransaction.model.js";
import AppError from "../utils/appError.js";
import logger from "../utils/logger.js";
import { getPaginationMetadata } from "../utils/pagination.js";
import {
  areUnitsConvertible,
  convertQuantity,
} from "../utils/measurement.utils.js";
import { INVENTORY_TRANSACTION_TYPES } from "../utils/constants.js";

const roundQuantity = (value) => Number(value.toFixed(6));
const expiryFilter = (now = new Date()) => ({
  $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
});
const availableFilter = (ingredient, now = new Date()) => ({
  ...(ingredient ? { ingredient } : {}),
  status: "AVAILABLE",
  remainingQuantity: { $gt: 0 },
  ...expiryFilter(now),
});
const mongoUnitFactor = (unitExpression) => ({
  $switch: {
    branches: [
      { case: { $eq: [unitExpression, "kg"] }, then: 1000 },
      { case: { $eq: [unitExpression, "L"] }, then: 1000 },
    ],
    default: 1,
  },
});

export const supportsMongoTransactions = () => {
  const type = mongoose.connection.client?.topology?.description?.type;
  return type === "ReplicaSetWithPrimary" || type === "Sharded";
};

/**
 * Use real Mongo transactions on replica sets/sharded clusters. Standalone MongoDB
 * has no multi-document transactions, so callers provide compensating rollback.
 */
export const runAtomicInventoryOperation = async (execute, rollback) => {
  if (supportsMongoTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await execute(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  try {
    return await execute(null);
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      logger.error(
        { errorName: rollbackError.name, errorCode: rollbackError.code },
        "Inventory operation rollback failed; manual reconciliation may be required",
      );
      throw AppError.internal(
        "Inventory operation failed and rollback was incomplete",
      );
    }
    throw error;
  }
};

class InventoryService {
  async rollbackRawMaterialWastage({ result }) {
    if (!result) return;
    await InventoryTransaction.deleteOne({
      _id: result.transactionId,
      referenceType: "WASTAGE",
    });
    const valid = !result.lot.expiryDate || result.lot.expiryDate > new Date();
    await InventoryLot.updateOne(
      { _id: result.lot._id },
      {
        $inc: { remainingQuantity: result.quantity },
        $set: { status: valid ? "AVAILABLE" : "EXPIRED" },
      },
    );
  }

  async recordRawMaterialWastage({ record, performedBy }) {
    const ingredient = await Ingredient.findOne({
      _id: record.ingredient,
      isActive: true,
    });
    const lot = await InventoryLot.findOne({
      _id: record.inventoryLot,
      ingredient: record.ingredient,
      status: "AVAILABLE",
      ...expiryFilter(),
    });
    if (!ingredient || !lot)
      throw AppError.badRequest(
        "An active ingredient and available unexpired inventory lot are required",
      );
    if (
      !areUnitsConvertible(record.unit, lot.unit) ||
      !areUnitsConvertible(record.unit, ingredient.unit)
    )
      throw AppError.badRequest(
        "Wastage quantity unit is incompatible with its ingredient or inventory lot",
      );
    const lotQuantity = convertQuantity(record.quantity, record.unit, lot.unit);
    const ingredientQuantity = convertQuantity(
      record.quantity,
      record.unit,
      ingredient.unit,
    );
    if (lotQuantity <= 0 || ingredientQuantity <= 0)
      throw AppError.badRequest("Wastage quantity is too small");
    const { currentStock } = await this.getCurrentStock(ingredient._id);
    const reservation = await Ingredient.updateOne(
      {
        _id: ingredient._id,
        isActive: true,
        $expr: {
          $lte: [
            {
              $add: [
                { $ifNull: ["$reservedStock", 0] },
                { $ifNull: ["$productionReservedStock", 0] },
                { $ifNull: ["$minimumStock", 0] },
                ingredientQuantity,
              ],
            },
            currentStock,
          ],
        },
      },
      { $inc: { productionReservedStock: ingredientQuantity } },
    );
    if (!reservation.modifiedCount)
      throw AppError.conflict(
        "Wastage would reduce stock below reserved or minimum inventory",
      );
    let changed = false;
    let transactionId;
    try {
      const next = roundQuantity(lot.remainingQuantity - lotQuantity);
      if (next < -0.000001)
        throw AppError.conflict(
          "Insufficient lot quantity for raw-material wastage",
        );
      const result = await InventoryLot.updateOne(
        {
          _id: lot._id,
          status: "AVAILABLE",
          remainingQuantity: lot.remainingQuantity,
          ...expiryFilter(),
        },
        {
          $set: {
            remainingQuantity: Math.max(0, next),
            ...(next <= 0.000001 ? { status: "DEPLETED" } : {}),
          },
        },
      );
      if (!result.modifiedCount)
        throw AppError.conflict(
          "Inventory lot changed; retry the wastage request",
        );
      changed = true;
      const [transaction] = await InventoryTransaction.create([
        {
          ingredient: ingredient._id,
          lot: lot._id,
          type: "WASTAGE",
          quantity: lotQuantity,
          unit: lot.unit,
          direction: "OUT",
          referenceType: "WASTAGE",
          referenceId: record._id,
          reason: `Raw material wastage: ${record.reason}`,
          performedBy,
        },
      ]);
      transactionId = transaction._id;
      await Ingredient.updateOne(
        {
          _id: ingredient._id,
          productionReservedStock: { $gte: ingredientQuantity },
        },
        { $inc: { productionReservedStock: -ingredientQuantity } },
      );
      return {
        transactionId,
        ingredient,
        lot,
        quantity: lotQuantity,
        unit: lot.unit,
      };
    } catch (error) {
      if (transactionId)
        await InventoryTransaction.deleteOne({ _id: transactionId });
      if (changed)
        await InventoryLot.updateOne(
          { _id: lot._id },
          {
            $set: {
              remainingQuantity: lot.remainingQuantity,
              status: lot.status,
            },
          },
        );
      await Ingredient.updateOne(
        {
          _id: ingredient._id,
          productionReservedStock: { $gte: ingredientQuantity },
        },
        { $inc: { productionReservedStock: -ingredientQuantity } },
      );
      throw error;
    }
  }

  async consumeForProduction(batch, performedBy) {
    const changedLots = [];
    const transactionIds = [];
    const reservedIngredients = [];
    const consumed = [];
    try {
      for (const requirement of batch.recipeSnapshot.ingredients) {
        const { ingredient, currentStock } = await this.getCurrentStock(
          requirement.ingredient,
        );
        if (!ingredient.isActive)
          throw AppError.conflict(`Ingredient ${ingredient.name} is inactive`);
        if (!areUnitsConvertible(requirement.unit, ingredient.unit))
          throw AppError.badRequest(
            `Unit ${requirement.unit} is incompatible with ingredient ${ingredient.name}`,
          );
        const quantity = convertQuantity(
          requirement.quantity,
          requirement.unit,
          ingredient.unit,
        );
        const reserve = await Ingredient.updateOne(
          {
            _id: ingredient._id,
            isActive: true,
            $expr: {
              $lte: [
                {
                  $add: [
                    { $ifNull: ["$reservedStock", 0] },
                    { $ifNull: ["$productionReservedStock", 0] },
                    { $ifNull: ["$minimumStock", 0] },
                    quantity,
                  ],
                },
                currentStock,
              ],
            },
          },
          { $inc: { productionReservedStock: quantity } },
        );
        if (!reserve.modifiedCount)
          throw AppError.conflict(
            `Insufficient available inventory for ${ingredient.name}`,
          );
        reservedIngredients.push({ id: ingredient._id, quantity });

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
        let remaining = quantity;
        for (const lot of lots) {
          if (remaining <= 0.000001) break;
          if (!areUnitsConvertible(lot.unit, ingredient.unit))
            throw AppError.internal(
              `Inventory lot ${lot._id} has an incompatible unit`,
            );
          const lotAvailable = convertQuantity(
            lot.remainingQuantity,
            lot.unit,
            ingredient.unit,
          );
          const takeIngredientUnit = Math.min(lotAvailable, remaining);
          const takeLotUnit = convertQuantity(
            takeIngredientUnit,
            ingredient.unit,
            lot.unit,
          );
          const nextQuantity = roundQuantity(
            lot.remainingQuantity - takeLotUnit,
          );
          const update = await InventoryLot.updateOne(
            {
              _id: lot._id,
              status: "AVAILABLE",
              remainingQuantity: lot.remainingQuantity,
            },
            {
              $set: {
                remainingQuantity: nextQuantity,
                ...(nextQuantity === 0 ? { status: "DEPLETED" } : {}),
              },
            },
          );
          if (!update.modifiedCount)
            throw AppError.conflict(
              "Inventory changed while consuming ingredients; retry production",
            );
          changedLots.push({ lot, nextQuantity });
          const [transaction] = await InventoryTransaction.create([
            {
              ingredient: ingredient._id,
              lot: lot._id,
              type: INVENTORY_TRANSACTION_TYPES.CONSUMPTION,
              quantity: takeLotUnit,
              unit: lot.unit,
              direction: "OUT",
              referenceType: "PRODUCTION",
              referenceId: batch._id,
              reason: `Production batch ${batch.batchNumber}`,
              performedBy,
            },
          ]);
          transactionIds.push(transaction._id);
          const supplier = lot.vendor
            ? await Vendor.findById(lot.vendor).select("name")
            : null;
          consumed.push({
            ingredient: ingredient._id,
            ingredientName: ingredient.name,
            lot: lot._id,
            lotNumber: lot.lotNumber,
            purchase: lot.purchase || null,
            vendor: lot.vendor || null,
            supplierNameSnapshot: supplier?.name || "",
            quantity: takeLotUnit,
            unit: lot.unit,
            unitCostSnapshot: lot.unitCost,
          });
          remaining = roundQuantity(remaining - takeIngredientUnit);
        }
        if (remaining > 0.000001)
          throw AppError.conflict(
            `Insufficient available inventory for ${ingredient.name}`,
          );
      }
      for (const item of reservedIngredients)
        await Ingredient.updateOne(
          { _id: item.id, productionReservedStock: { $gte: item.quantity } },
          { $inc: { productionReservedStock: -item.quantity } },
        );
      return consumed;
    } catch (error) {
      if (transactionIds.length)
        await InventoryTransaction.deleteMany({ _id: { $in: transactionIds } });
      for (const item of changedLots.reverse())
        await InventoryLot.updateOne(
          { _id: item.lot._id },
          {
            $set: {
              remainingQuantity: item.lot.remainingQuantity,
              status: item.lot.status,
            },
          },
        );
      for (const item of reservedIngredients)
        await Ingredient.updateOne(
          { _id: item.id, productionReservedStock: { $gte: item.quantity } },
          { $inc: { productionReservedStock: -item.quantity } },
        );
      throw error;
    }
  }

  async recordPurchaseStock(purchase, session = null) {
    const lots = purchase.items.map((item) => ({
      ingredient: item.ingredient,
      purchase: purchase._id,
      purchaseItemId: item._id,
      vendor: purchase.vendor,
      lotNumber: item.lotNumber,
      originalQuantity: item.quantity,
      remainingQuantity: item.quantity,
      unit: item.unit,
      unitCost: item.unitPrice,
      purchaseDate: purchase.purchaseDate,
      expiryDate: item.expiryDate,
      status: "AVAILABLE",
    }));
    const options = session ? { session } : {};
    const savedLots = await InventoryLot.insertMany(lots, options);
    const transactions = savedLots.map((lot) => ({
      ingredient: lot.ingredient,
      lot: lot._id,
      type: INVENTORY_TRANSACTION_TYPES.PURCHASE,
      quantity: lot.originalQuantity,
      unit: lot.unit,
      direction: "IN",
      referenceType: "PURCHASE",
      referenceId: purchase._id,
      reason: purchase.invoiceNumber
        ? `Purchase invoice ${purchase.invoiceNumber}`
        : "Purchase received",
      performedBy: purchase.createdBy,
    }));
    await InventoryTransaction.insertMany(transactions, options);
    return savedLots;
  }

  async markExpiredLots(now = new Date()) {
    await InventoryLot.updateMany(
      { status: "AVAILABLE", expiryDate: { $lte: now } },
      { $set: { status: "EXPIRED" } },
    );
  }

  async getCurrentStock(ingredientId, session = null) {
    const ingredient = await Ingredient.findById(ingredientId).session(session);
    if (!ingredient) throw AppError.notFound("Ingredient not found");
    const lots = await InventoryLot.find(
      availableFilter(ingredient._id),
    ).session(session);
    const currentStock = lots.reduce((sum, lot) => {
      if (!areUnitsConvertible(lot.unit, ingredient.unit)) {
        throw AppError.internal(
          `Inventory lot ${lot._id} has a unit incompatible with its ingredient`,
        );
      }
      return (
        sum + convertQuantity(lot.remainingQuantity, lot.unit, ingredient.unit)
      );
    }, 0);
    return {
      ingredient,
      currentStock: roundQuantity(currentStock),
      unit: ingredient.unit,
    };
  }

  async getInventoryLots(ingredientId, { page = 1, limit = 20 } = {}) {
    await this.markExpiredLots();
    const ingredient = await Ingredient.findById(ingredientId);
    if (!ingredient) throw AppError.notFound("Ingredient not found");
    const filter = { ingredient: ingredient._id };
    const [lots, total, stock] = await Promise.all([
      InventoryLot.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("vendor", "name")
        .populate("purchase", "purchaseDate invoiceNumber"),
      InventoryLot.countDocuments(filter),
      this.getCurrentStock(ingredient._id),
    ]);
    return {
      ingredient,
      currentStock: stock.currentStock,
      unit: ingredient.unit,
      lots,
      meta: getPaginationMetadata(total, page, limit),
    };
  }

  async getStockPage({ page, limit, lowStockOnly = false }) {
    const now = new Date();
    const factorToBase = mongoUnitFactor("$unit");
    const ingredientFactorToBase = mongoUnitFactor("$$ingredientUnit");
    const result = await Ingredient.aggregate([
      ...(lowStockOnly ? [{ $match: { isActive: true } }] : []),
      {
        $lookup: {
          from: InventoryLot.collection.name,
          let: { ingredientId: "$_id", ingredientUnit: "$unit" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$ingredient", "$$ingredientId"] },
                    { $eq: ["$status", "AVAILABLE"] },
                    { $gt: ["$remainingQuantity", 0] },
                    {
                      $or: [
                        { $eq: ["$expiryDate", null] },
                        { $gt: ["$expiryDate", now] },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $addFields: {
                normalizedQuantity: {
                  $multiply: [
                    "$remainingQuantity",
                    { $divide: [factorToBase, ingredientFactorToBase] },
                  ],
                },
              },
            },
            { $group: { _id: null, total: { $sum: "$normalizedQuantity" } } },
          ],
          as: "stockSummary",
        },
      },
      {
        $addFields: {
          currentStock: {
            $ifNull: [{ $arrayElemAt: ["$stockSummary.total", 0] }, 0],
          },
          lowStockThreshold: {
            $cond: [
              { $gt: ["$reorderLevel", 0] },
              "$reorderLevel",
              "$minimumStock",
            ],
          },
        },
      },
      ...(lowStockOnly
        ? [
            {
              $match: {
                $expr: {
                  $and: [
                    { $gt: ["$lowStockThreshold", 0] },
                    { $lt: ["$currentStock", "$lowStockThreshold"] },
                  ],
                },
              },
            },
          ]
        : []),
      {
        $project: {
          name: 1,
          slug: 1,
          unit: 1,
          minimumStock: 1,
          reorderLevel: 1,
          isActive: 1,
          currentStock: 1,
          lowStockThreshold: 1,
        },
      },
      { $sort: { name: 1 } },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ]);
    const items = result[0]?.items || [];
    const total = result[0]?.total?.[0]?.count || 0;
    return { items, meta: getPaginationMetadata(total, page, limit) };
  }

  async listExpiring({ days, page, limit }) {
    const now = new Date();
    await this.markExpiredLots(now);
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const filter = {
      status: "AVAILABLE",
      remainingQuantity: { $gt: 0 },
      expiryDate: { $gt: now, $lte: until },
    };
    const [lots, total] = await Promise.all([
      InventoryLot.find(filter)
        .sort({ expiryDate: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("ingredient", "name unit")
        .populate("vendor", "name")
        .populate("purchase", "purchaseDate invoiceNumber"),
      InventoryLot.countDocuments(filter),
    ]);
    return { lots, meta: getPaginationMetadata(total, page, limit) };
  }

  async listTransactions({ page, limit, ingredient, type, from, to }) {
    const filter = {};
    if (ingredient) filter.ingredient = ingredient;
    if (type) filter.type = type;
    if (from || to)
      filter.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    const [transactions, total] = await Promise.all([
      InventoryTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("ingredient", "name unit")
        .populate("lot", "lotNumber unitCost unit")
        .populate("performedBy", "name"),
      InventoryTransaction.countDocuments(filter),
    ]);
    return { transactions, meta: getPaginationMetadata(total, page, limit) };
  }

  async inventoryValue() {
    const now = new Date();
    const result = await InventoryLot.aggregate([
      { $match: { ...availableFilter(undefined, now) } },
      {
        $group: {
          _id: "$ingredient",
          value: { $sum: { $multiply: ["$remainingQuantity", "$unitCost"] } },
        },
      },
      {
        $lookup: {
          from: Ingredient.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "ingredient",
        },
      },
      { $unwind: { path: "$ingredient", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          ingredientId: "$_id",
          name: { $ifNull: ["$ingredient.name", "Unknown ingredient"] },
          value: { $round: ["$value", 2] },
        },
      },
      {
        $facet: {
          ingredients: [{ $sort: { name: 1 } }],
          total: [{ $group: { _id: null, value: { $sum: "$value" } } }],
        },
      },
    ]);
    return {
      value: result[0]?.total?.[0]?.value || 0,
      ingredients: result[0]?.ingredients || [],
    };
  }

  async adjustStock({
    ingredientId,
    quantity,
    unit,
    type,
    reason,
    performedBy,
    unitCost = 0,
    expiryDate = null,
    lotNumber = null,
  }) {
    const ingredient = await Ingredient.findOne({
      _id: ingredientId,
      isActive: true,
    });
    if (!ingredient) throw AppError.notFound("Active ingredient not found");
    if (!areUnitsConvertible(unit, ingredient.unit))
      throw AppError.badRequest(
        `Unit ${unit} is not compatible with ingredient unit ${ingredient.unit}`,
      );
    const quantityInIngredientUnit = convertQuantity(
      quantity,
      unit,
      ingredient.unit,
    );
    if (quantityInIngredientUnit <= 0)
      throw AppError.badRequest("Adjustment quantity is too small");
    const referenceId = new mongoose.Types.ObjectId();
    let createdLotId = null;
    const changedLots = [];
    const transactionIds = [];
    let adjustmentReservation = false;

    return runAtomicInventoryOperation(
      async (session) => {
        if (type === "ADD") {
          const [lot] = await InventoryLot.create(
            [
              {
                ingredient: ingredient._id,
                lotNumber: lotNumber || `ADJUST-${referenceId.toString()}`,
                originalQuantity: quantity,
                remainingQuantity: quantity,
                unit,
                unitCost: Number(unitCost || 0),
                purchaseDate: new Date(),
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                status: "AVAILABLE",
              },
            ],
            session ? { session } : {},
          );
          createdLotId = lot._id;
          const [transaction] = await InventoryTransaction.create(
            [
              {
                ingredient: ingredient._id,
                lot: lot._id,
                type: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
                quantity,
                unit,
                direction: "IN",
                referenceType: "ADJUSTMENT",
                referenceId,
                reason,
                performedBy,
              },
            ],
            session ? { session } : {},
          );
          transactionIds.push(transaction._id);
          return this.getCurrentStock(ingredient._id, session);
        }

        const now = new Date();
        const lots = await InventoryLot.aggregate([
          { $match: availableFilter(ingredient._id, now) },
          {
            $addFields: {
              fefoExpiry: {
                $ifNull: ["$expiryDate", new Date("9999-12-31T23:59:59.999Z")],
              },
            },
          },
          { $sort: { fefoExpiry: 1, createdAt: 1, _id: 1 } },
        ]).session(session);
        const totalAvailable = lots.reduce(
          (sum, lot) =>
            sum +
            convertQuantity(lot.remainingQuantity, lot.unit, ingredient.unit),
          0,
        );
        if (totalAvailable + 0.000001 < quantityInIngredientUnit) {
          throw AppError.badRequest(
            "Insufficient available inventory for this adjustment",
          );
        }
        if (
          totalAvailable - quantityInIngredientUnit + 0.000001 <
          (ingredient.reservedStock || 0) +
            (ingredient.productionReservedStock || 0)
        ) {
          throw AppError.conflict(
            "Stock cannot be reduced below quantities reserved for active customer orders",
          );
        }
        const reservation = await Ingredient.updateOne(
          {
            _id: ingredient._id,
            isActive: true,
            $expr: {
              $lte: [
                {
                  $add: [
                    { $ifNull: ["$reservedStock", 0] },
                    { $ifNull: ["$productionReservedStock", 0] },
                    { $ifNull: ["$minimumStock", 0] },
                    quantityInIngredientUnit,
                  ],
                },
                totalAvailable,
              ],
            },
          },
          { $inc: { productionReservedStock: quantityInIngredientUnit } },
          session ? { session } : {},
        );
        if (!reservation.modifiedCount)
          throw AppError.conflict(
            "Inventory reservations changed during the adjustment; retry the request",
          );
        adjustmentReservation = true;
        let remainingToRemove = quantityInIngredientUnit;
        const allocations = [];
        for (const lot of lots) {
          if (remainingToRemove <= 0.000001) break;
          const lotAvailable = convertQuantity(
            lot.remainingQuantity,
            lot.unit,
            ingredient.unit,
          );
          const takeInIngredientUnit = Math.min(
            lotAvailable,
            remainingToRemove,
          );
          const takeInLotUnit = convertQuantity(
            takeInIngredientUnit,
            ingredient.unit,
            lot.unit,
          );
          allocations.push({
            lot,
            quantity: takeInLotUnit,
            remaining: roundQuantity(lot.remainingQuantity - takeInLotUnit),
          });
          remainingToRemove = roundQuantity(
            remainingToRemove - takeInIngredientUnit,
          );
        }
        if (remainingToRemove > 0.000001)
          throw AppError.badRequest(
            "Insufficient available inventory for this adjustment",
          );
        for (const allocation of allocations) {
          changedLots.push({
            _id: allocation.lot._id,
            remainingQuantity: allocation.lot.remainingQuantity,
            status: allocation.lot.status,
          });
          const updateResult = await InventoryLot.updateOne(
            {
              _id: allocation.lot._id,
              remainingQuantity: allocation.lot.remainingQuantity,
            },
            {
              $set: {
                remainingQuantity: allocation.remaining,
                ...(allocation.remaining === 0 ? { status: "DEPLETED" } : {}),
              },
            },
            session ? { session } : {},
          );
          if (!updateResult.modifiedCount)
            throw AppError.conflict(
              "Inventory changed during the adjustment; retry the request",
            );
          const [transaction] = await InventoryTransaction.create(
            [
              {
                ingredient: ingredient._id,
                lot: allocation.lot._id,
                type: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
                quantity: allocation.quantity,
                unit: allocation.lot.unit,
                direction: "OUT",
                referenceType: "ADJUSTMENT",
                referenceId,
                reason,
                performedBy,
              },
            ],
            session ? { session } : {},
          );
          transactionIds.push(transaction._id);
        }
        await Ingredient.updateOne(
          {
            _id: ingredient._id,
            productionReservedStock: { $gte: quantityInIngredientUnit },
          },
          { $inc: { productionReservedStock: -quantityInIngredientUnit } },
          session ? { session } : {},
        );
        adjustmentReservation = false;
        return this.getCurrentStock(ingredient._id, session);
      },
      async () => {
        if (transactionIds.length)
          await InventoryTransaction.deleteMany({
            _id: { $in: transactionIds },
          });
        if (createdLotId) await InventoryLot.deleteOne({ _id: createdLotId });
        for (const lot of changedLots)
          await InventoryLot.updateOne(
            { _id: lot._id },
            {
              $set: {
                remainingQuantity: lot.remainingQuantity,
                status: lot.status,
              },
            },
          );
        if (adjustmentReservation)
          await Ingredient.updateOne(
            {
              _id: ingredient._id,
              productionReservedStock: { $gte: quantityInIngredientUnit },
            },
            { $inc: { productionReservedStock: -quantityInIngredientUnit } },
          );
      },
    );
  }
}

export const inventoryService = new InventoryService();
export default inventoryService;
