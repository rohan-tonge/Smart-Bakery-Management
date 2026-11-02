import categoryService from "../services/category.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { USER_ROLES } from "../utils/constants.js";

const manager = (req) =>
  Boolean(
    req.user &&
      [
        USER_ROLES.OWNER,
        USER_ROLES.MANAGER,
        USER_ROLES.OWNER_MANAGER,
      ].includes(req.user.role),
  );
export const createCategory = asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Category created successfully", data: { category: await categoryService.create(req.body) } }));
export const listCategories = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Categories retrieved successfully", data: { categories: await categoryService.list({ includeInactive: manager(req) }) } }));
export const getCategory = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Category retrieved successfully", data: { category: await categoryService.getById(req.params.id, manager(req)) } }));
export const updateCategory = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Category updated successfully", data: { category: await categoryService.update(req.params.id, req.body) } }));
export const deleteCategory = asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Category deactivated successfully", data: { category: await categoryService.remove(req.params.id) } }));
export default { createCategory, listCategories, getCategory, updateCategory, deleteCategory };
