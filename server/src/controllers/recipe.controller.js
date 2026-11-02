import recipeService from "../services/recipe.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const createRecipe = asyncHandler(async (req, res) => ApiResponse.created(res, {
  message: "Recipe created successfully",
  data: { recipe: await recipeService.create(req.params.productId, req.params.variantId, req.body) },
}));

export const getRecipe = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Recipe retrieved successfully",
  data: { recipe: await recipeService.get(req.params.productId, req.params.variantId, req.user) },
}));

export const updateRecipe = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Recipe updated successfully",
  data: { recipe: await recipeService.update(req.params.productId, req.params.variantId, req.body) },
}));

export const deleteRecipe = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Recipe deactivated successfully",
  data: { recipe: await recipeService.deactivate(req.params.productId, req.params.variantId) },
}));

export const calculateRecipe = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Recipe requirements calculated successfully",
  data: await recipeService.calculate(req.body, req.user),
}));

export default { createRecipe, getRecipe, updateRecipe, deleteRecipe, calculateRecipe };
