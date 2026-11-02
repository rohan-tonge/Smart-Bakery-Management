import mongoose from "mongoose";
import Ingredient from "../models/ingredient.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import Recipe from "../models/recipe.model.js";
import Order from "../models/order.model.js";
import AppError from "../utils/appError.js";
import { getPaginationMetadata } from "../utils/pagination.js";
import {
  areUnitsConvertible,
  convertQuantity,
} from "../utils/measurement.utils.js";
import inventoryService from "./inventory.service.js";

const slugify = (value) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const assertId = (id) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest("Invalid ingredient ID");
};

class IngredientService {
  async create(input, user = null) {
    const name = input.name.trim().replace(/\s+/g, " ");
    const duplicate = await Ingredient.findOne({
      name: new RegExp(`^${escapeRegex(name)}$`, "i"),
      isActive: true,
    });
    if (duplicate)
      throw AppError.conflict(
        "An active ingredient with this name already exists",
      );

    const ingredientData = {
      name,
      slug: slugify(input.slug || name),
      description: input.description,
      unit: input.unit,
      minimumStock: input.minimumStock !== undefined ? Number(input.minimumStock) : 0,
      reorderLevel: input.reorderLevel !== undefined ? Number(input.reorderLevel) : 0,
      isActive: input.isActive !== undefined ? input.isActive : true,
    };

    const ingredient = await Ingredient.create(ingredientData);

    if (input.openingStock && Number(input.openingStock) > 0) {
      const openingQty = Number(input.openingStock);
      const openingUnit = input.openingStockUnit || ingredient.unit;
      const performedBy = user?._id || new mongoose.Types.ObjectId();
      await inventoryService.adjustStock({
        ingredientId: ingredient._id,
        quantity: openingQty,
        unit: openingUnit,
        type: "ADD",
        reason: input.description?.trim() || "Initial opening stock balance for recipe setup",
        unitCost: Number(input.openingStockCost || 0),
        expiryDate: input.openingStockExpiryDate || null,
        lotNumber: input.openingStockLotNumber || `OPENING-${ingredient.slug.slice(0, 16).toUpperCase()}-${Date.now().toString().slice(-6)}`,
        performedBy,
      });
      ingredient.set("currentStock", openingQty, { strict: false });
    }

    return ingredient;
  }

  async list({ page, limit, search, unit, isActive, canManage }) {
    const filter = {
      isActive: canManage && isActive !== undefined ? isActive : true,
    };
    if (unit) filter.unit = unit;
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: expression }, { description: expression }];
    }
    const [ingredients, total] = await Promise.all([
      Ingredient.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Ingredient.countDocuments(filter),
    ]);
    return { ingredients, meta: getPaginationMetadata(total, page, limit) };
  }

  async getById(id, includeInactive = false) {
    assertId(id);
    const ingredient = await Ingredient.findOne({
      _id: id,
      ...(includeInactive ? {} : { isActive: true }),
    });
    if (!ingredient) throw AppError.notFound("Ingredient not found");
    return ingredient;
  }

  async update(id, input) {
    assertId(id);
    const ingredient = await Ingredient.findById(id);
    if (!ingredient) throw AppError.notFound("Ingredient not found");
    if (input.name) input.name = input.name.trim().replace(/\s+/g, " ");
    if (input.name) {
      const duplicate = await Ingredient.findOne({
        _id: { $ne: ingredient._id },
        isActive: true,
        name: new RegExp(`^${escapeRegex(input.name)}$`, "i"),
      });
      if (duplicate)
        throw AppError.conflict(
          "An active ingredient with this name already exists",
        );
    }
    if (input.unit && input.unit !== ingredient.unit) {
      const [hasInventoryHistory, hasRecipeHistory] = await Promise.all([
        InventoryLot.exists({ ingredient: ingredient._id }),
        Recipe.exists({ "ingredients.ingredient": ingredient._id }),
      ]);
      const hasOrderHistory = await Order.exists({
        "ingredientCommitments.ingredient": ingredient._id,
      });
      if (hasInventoryHistory || hasRecipeHistory || hasOrderHistory) {
        throw AppError.badRequest(
          "Ingredient unit cannot change after inventory, recipe, or order history exists",
        );
      }
    }
    Object.assign(ingredient, input);
    if (input.name && !input.slug) ingredient.slug = slugify(input.name);
    if (input.slug) ingredient.slug = slugify(input.slug);
    await ingredient.save();
    return ingredient;
  }

  async deactivate(id) {
    assertId(id);
    const ingredient = await Ingredient.findById(id);
    if (!ingredient) throw AppError.notFound("Ingredient not found");
    ingredient.isActive = false;
    await ingredient.save();
    return ingredient;
  }

  async validateRecipeIngredients(lines) {
    const ids = lines.map((line) => line.ingredient);
    if (new Set(ids.map(String)).size !== ids.length) {
      throw AppError.badRequest(
        "An ingredient can only appear once in a recipe",
      );
    }
    const ingredients = await Ingredient.find({
      _id: { $in: ids },
      isActive: true,
    });
    if (ingredients.length !== ids.length) {
      throw AppError.badRequest(
        "Every recipe ingredient must reference an active ingredient",
      );
    }
    const byId = new Map(
      ingredients.map((ingredient) => [ingredient._id.toString(), ingredient]),
    );
    return lines.map((line) => {
      const ingredient = byId.get(String(line.ingredient));
      if (!ingredient)
        throw AppError.badRequest("Invalid recipe ingredient reference");
      if (!areUnitsConvertible(line.unit, ingredient.unit)) {
        throw AppError.badRequest(
          `Recipe unit ${line.unit} is not compatible with ingredient unit ${ingredient.unit}`,
        );
      }
      return {
        ingredient: ingredient._id,
        quantity: convertQuantity(line.quantity, line.unit, ingredient.unit),
        unit: ingredient.unit,
      };
    });
  }
}

export const ingredientService = new IngredientService();
export default ingredientService;
