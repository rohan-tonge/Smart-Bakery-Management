import ingredientService from "../services/ingredient.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { USER_ROLES } from "../utils/constants.js";

const canManage = (req) =>
  [
    USER_ROLES.OWNER,
    USER_ROLES.MANAGER,
    USER_ROLES.OWNER_MANAGER,
  ].includes(req.user?.role);
export const createIngredient = asyncHandler(async (req, res) => ApiResponse.created(res, {
  message: "Ingredient created successfully",
  data: { ingredient: await ingredientService.create(req.body, req.user) },
}));

export const listIngredients = asyncHandler(async (req, res) => {
  const result = await ingredientService.list({ ...req.query, canManage: canManage(req) });
  return ApiResponse.success(res, {
    message: "Ingredients retrieved successfully",
    data: { ingredients: result.ingredients },
    meta: result.meta,
  });
});

export const getIngredient = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Ingredient retrieved successfully",
  data: { ingredient: await ingredientService.getById(req.params.id, canManage(req)) },
}));

export const updateIngredient = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Ingredient updated successfully",
  data: { ingredient: await ingredientService.update(req.params.id, req.body) },
}));

export const deleteIngredient = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Ingredient deactivated successfully",
  data: { ingredient: await ingredientService.deactivate(req.params.id) },
}));

export default { createIngredient, listIngredients, getIngredient, updateIngredient, deleteIngredient };
