import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Recipe from "../models/recipe.model.js";
import AppError from "../utils/appError.js";
import ingredientService from "./ingredient.service.js";
import recipeCostingService from "./recipeCosting.service.js";
import { USER_ROLES } from "../utils/constants.js";

const canManage = (user) =>
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
const assertId = (id, field) => {
  if (!mongoose.isValidObjectId(id))
    throw AppError.badRequest(`Invalid ${field}`);
};
const findProductVariant = async (productId, variantId) => {
  assertId(productId, "product ID");
  assertId(variantId, "variant ID");
  const product = await Product.findById(productId);
  if (!product) throw AppError.notFound("Product not found");
  const variant = product.variants.id(variantId);
  if (!variant) throw AppError.notFound("Product variant not found");
  return { product, variant };
};

class RecipeService {
  async create(productId, variantId, input) {
    const { product, variant } = await findProductVariant(productId, variantId);
    const ingredients = await ingredientService.validateRecipeIngredients(
      input.ingredients,
    );
    const existing = await Recipe.findOne({
      product: productId,
      variant: variantId,
      isActive: true,
    });
    if (existing)
      throw AppError.conflict(
        "An active recipe already exists for this product variant",
      );

    const recipeData = { ...input };
    if (recipeData.totalTimeMinutes !== undefined || recipeData.totalTime !== undefined) {
      const t = Number(recipeData.totalTimeMinutes ?? recipeData.totalTime);
      recipeData.productionTime = t;
      recipeData.preparationTime = 0;
      recipeData.estimatedDurationMinutes = t;
    } else if (recipeData.duration !== undefined && recipeData.productionTime === undefined) {
      recipeData.productionTime = recipeData.duration;
    }
    delete recipeData.duration;
    delete recipeData.totalTime;
    delete recipeData.totalTimeMinutes;

    const prep = Number(recipeData.preparationTime || 0);
    const prod = Number(recipeData.productionTime || 0);
    const totalDuration = prep + prod;
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      throw AppError.badRequest(
        "Recipe must define a positive preparation or production duration in minutes",
      );
    }
    const estimatedDurationMinutes = Number(recipeData.estimatedDurationMinutes) || totalDuration;

    const recipe = await Recipe.create({
      ...recipeData,
      preparationTime: prep,
      productionTime: prod,
      estimatedDurationMinutes,
      ingredients,
      product: productId,
      variant: variantId,
    });
    await Product.findByIdAndUpdate(productId, {
      totalTimeMinutes: totalDuration,
      preparationTime: prep || totalDuration,
      productionTime: prod,
    });
    const populated = await recipe.populate("ingredients.ingredient", "name slug unit isActive");
    const resultObj = populated.toObject();
    resultObj.costing = await recipeCostingService.calculateRecipeCosting(populated, variant.price);
    return resultObj;
  }

  async get(productId, variantId, user) {
    const manager = canManage(user);
    const { product, variant } = await findProductVariant(productId, variantId);
    if (
      !manager &&
      (!product.isActive ||
        !product.isAvailable ||
        !variant.isActive ||
        !variant.isAvailable)
    ) {
      throw AppError.notFound("Recipe not found");
    }
    let recipe = await Recipe.findOne({
      product: productId,
      variant: variantId,
      isActive: true,
    }).populate("ingredients.ingredient", "name slug unit isActive");
    if (!recipe && manager) {
      recipe = await Recipe.findOne({
        product: productId,
        variant: variantId,
        isActive: false,
      })
        .sort({ updatedAt: -1 })
        .populate("ingredients.ingredient", "name slug unit isActive");
    }
    if (!recipe) throw AppError.notFound("Recipe not found");
    const resultObj = recipe.toObject();
    resultObj.costing = await recipeCostingService.calculateRecipeCosting(recipe, variant.price);
    return resultObj;
  }

  async update(productId, variantId, input) {
    const { product, variant } = await findProductVariant(productId, variantId);
    const recipe = await Recipe.findOne({
      product: productId,
      variant: variantId,
      isActive: true,
    });
    if (!recipe) throw AppError.notFound("Active recipe not found");

    const updateData = { ...input };
    if (updateData.totalTimeMinutes !== undefined || updateData.totalTime !== undefined) {
      const t = Number(updateData.totalTimeMinutes ?? updateData.totalTime);
      updateData.productionTime = t;
      updateData.preparationTime = 0;
      updateData.estimatedDurationMinutes = t;
    } else if (updateData.duration !== undefined && updateData.productionTime === undefined) {
      updateData.productionTime = updateData.duration;
    }
    delete updateData.duration;
    delete updateData.totalTime;
    delete updateData.totalTimeMinutes;

    if (
      updateData.preparationTime !== undefined ||
      updateData.productionTime !== undefined
    ) {
      const nextPrep =
        updateData.preparationTime !== undefined
          ? Number(updateData.preparationTime)
          : Number(recipe.preparationTime || 0);
      const nextProd =
        updateData.productionTime !== undefined
          ? Number(updateData.productionTime)
          : Number(recipe.productionTime || 0);
      const nextTotal = nextPrep + nextProd;
      if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
        throw AppError.badRequest(
          "Recipe must define a positive preparation or production duration in minutes",
        );
      }
    }

    if (updateData.ingredients)
      updateData.ingredients = await ingredientService.validateRecipeIngredients(
        updateData.ingredients,
      );
    Object.assign(recipe, updateData);
    recipe.revision += 1;
    await recipe.save();
    if (
      updateData.preparationTime !== undefined ||
      updateData.productionTime !== undefined
    ) {
      const nextTotal = (recipe.preparationTime || 0) + (recipe.productionTime || 0);
      await Product.findByIdAndUpdate(productId, {
        totalTimeMinutes: nextTotal,
        preparationTime: recipe.preparationTime,
        productionTime: recipe.productionTime,
      });
    }
    const populated = await recipe.populate("ingredients.ingredient", "name slug unit isActive");
    const resultObj = populated.toObject();
    resultObj.costing = await recipeCostingService.calculateRecipeCosting(populated, variant.price);
    return resultObj;
  }

  async deactivate(productId, variantId) {
    return this.update(productId, variantId, { isActive: false });
  }

  async calculate({ productId, variantId, quantity }, user) {
    const manager = canManage(user);
    const { product, variant } = await findProductVariant(productId, variantId);
    if (
      !manager &&
      (!product.isActive ||
        !product.isAvailable ||
        !variant.isActive ||
        !variant.isAvailable)
    ) {
      throw AppError.notFound("Recipe not found");
    }
    const recipe = await Recipe.findOne({
      product: productId,
      variant: variantId,
      isActive: true,
    }).populate("ingredients.ingredient", "name unit isActive");
    if (!recipe) throw AppError.notFound("Active recipe not found");
    const inactiveIngredient = recipe.ingredients.find(
      (line) => !line.ingredient || !line.ingredient.isActive,
    );
    if (inactiveIngredient)
      throw AppError.badRequest(
        "Recipe contains an inactive ingredient and cannot be calculated",
      );

    const costing = await recipeCostingService.calculateRecipeCosting(recipe, variant.price);

    return {
      product: product.name,
      variant: variant.name,
      productionQuantity: quantity,
      expectedOutput: Number((recipe.expectedYield * quantity).toFixed(6)),
      yieldUnit: recipe.yieldUnit,
      recipeRevision: recipe.revision,
      costing,
      ingredients: recipe.ingredients.map((line) => ({
        ingredientId: line.ingredient._id,
        name: line.ingredient.name,
        quantity: Number((line.quantity * quantity).toFixed(6)),
        unit: line.unit,
      })),
    };
  }
}

export const recipeService = new RecipeService();
export default recipeService;
