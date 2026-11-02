import mongoose from "mongoose";
import Purchase from "../models/purchase.model.js";
import Vendor from "../models/vendor.model.js";
import Ingredient from "../models/ingredient.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import InventoryTransaction from "../models/inventoryTransaction.model.js";
import AppError from "../utils/appError.js";
import { getPaginationMetadata } from "../utils/pagination.js";
import { areUnitsConvertible } from "../utils/measurement.utils.js";
import {
  inventoryService,
  runAtomicInventoryOperation,
} from "./inventory.service.js";

const money = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
const assertId = (id) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest("Invalid purchase ID");
};

class PurchaseService {
  async create(input, createdBy) {
    const vendor = await Vendor.findOne({ _id: input.vendor, isActive: true });
    if (!vendor)
      throw AppError.badRequest("Vendor does not exist or is inactive");
    const ingredientIds = [
      ...new Set(input.items.map((item) => item.ingredient)),
    ];
    const ingredients = await Ingredient.find({
      _id: { $in: ingredientIds },
      isActive: true,
    });
    if (ingredients.length !== ingredientIds.length)
      throw AppError.badRequest(
        "Every purchase item must reference an active ingredient",
      );
    const ingredientsById = new Map(
      ingredients.map((ingredient) => [ingredient._id.toString(), ingredient]),
    );
    const lotKeys = new Set();
    for (const item of input.items) {
      const ingredient = ingredientsById.get(item.ingredient);
      if (!ingredient)
        throw AppError.badRequest("Invalid purchase ingredient reference");
      if (!areUnitsConvertible(item.unit, ingredient.unit)) {
        throw AppError.badRequest(
          `Purchase unit ${item.unit} is not compatible with ingredient unit ${ingredient.unit}`,
        );
      }
      if (item.expiryDate && item.expiryDate <= input.purchaseDate) {
        throw AppError.badRequest(
          "Purchase item expiry date must be after the purchase date",
        );
      }
      const key = `${item.ingredient}:${item.lotNumber.toLowerCase()}`;
      if (lotKeys.has(key))
        throw AppError.badRequest(
          "A purchase cannot repeat the same ingredient lot number",
        );
      lotKeys.add(key);
    }

    const items = input.items.map((item) => ({
      ...item,
      totalPrice: money(item.quantity * item.unitPrice),
    }));
    const subtotal = money(
      items.reduce((sum, item) => sum + item.totalPrice, 0),
    );
    const tax = money(input.tax || 0);
    const totalAmount = money(subtotal + tax);
    let purchaseId;

    return runAtomicInventoryOperation(
      async (session) => {
        const purchase = new Purchase({
          vendor: vendor._id,
          purchaseDate: input.purchaseDate,
          ...(input.invoiceNumber
            ? { invoiceNumber: input.invoiceNumber }
            : {}),
          items,
          subtotal,
          tax,
          totalAmount,
          notes: input.notes || "",
          createdBy,
        });
        purchaseId = purchase._id;
        await purchase.save(session ? { session } : {});
        await inventoryService.recordPurchaseStock(purchase, session);
        return purchase.populate([
          { path: "vendor", select: "name contactPerson phone email" },
          { path: "items.ingredient", select: "name slug unit" },
          { path: "createdBy", select: "name" },
        ]);
      },
      async () => {
        if (!purchaseId) return;
        await InventoryTransaction.deleteMany({
          referenceType: "PURCHASE",
          referenceId: purchaseId,
        });
        await InventoryLot.deleteMany({ purchase: purchaseId });
        await Purchase.deleteOne({ _id: purchaseId });
      },
    );
  }

  async list({ page, limit, vendor, ingredient, from, to }) {
    const filter = {};
    if (vendor) filter.vendor = vendor;
    if (ingredient) filter["items.ingredient"] = ingredient;
    if (from || to)
      filter.purchaseDate = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    const [purchases, total] = await Promise.all([
      Purchase.find(filter)
        .sort({ purchaseDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("vendor", "name contactPerson phone email")
        .populate("items.ingredient", "name slug unit")
        .populate("createdBy", "name"),
      Purchase.countDocuments(filter),
    ]);
    return { purchases, meta: getPaginationMetadata(total, page, limit) };
  }

  async getById(id) {
    assertId(id);
    const purchase = await Purchase.findById(id)
      .populate("vendor", "name contactPerson phone email address gstNumber")
      .populate("items.ingredient", "name slug unit")
      .populate("createdBy", "name");
    if (!purchase) throw AppError.notFound("Purchase not found");
    return purchase;
  }
}

export const purchaseService = new PurchaseService();
export default purchaseService;
