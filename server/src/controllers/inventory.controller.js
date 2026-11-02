import inventoryService from "../services/inventory.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const listInventory = asyncHandler(async (req, res) => {
  const result = await inventoryService.getStockPage(req.query);
  return ApiResponse.success(res, { message: "Inventory retrieved successfully", data: { inventory: result.items }, meta: result.meta });
});
export const getIngredientInventory = asyncHandler(async (req, res) => {
  const result = await inventoryService.getInventoryLots(req.params.ingredientId, req.query);
  return ApiResponse.success(res, {
    message: "Ingredient inventory retrieved successfully",
    data: { ingredient: result.ingredient, currentStock: result.currentStock, unit: result.unit, lots: result.lots },
    meta: result.meta,
  });
});
export const getLowStock = asyncHandler(async (req, res) => {
  const result = await inventoryService.getStockPage({ ...req.query, lowStockOnly: true });
  return ApiResponse.success(res, { message: "Low stock ingredients retrieved successfully", data: { ingredients: result.items }, meta: result.meta });
});
export const getExpiring = asyncHandler(async (req, res) => {
  const result = await inventoryService.listExpiring(req.query);
  return ApiResponse.success(res, { message: "Expiring inventory retrieved successfully", data: { lots: result.lots }, meta: result.meta });
});
export const getTransactions = asyncHandler(async (req, res) => {
  const result = await inventoryService.listTransactions(req.query);
  return ApiResponse.success(res, { message: "Inventory transactions retrieved successfully", data: { transactions: result.transactions }, meta: result.meta });
});
export const getIngredientTransactions = asyncHandler(async (req, res) => {
  const result = await inventoryService.listTransactions({ ...req.query, ingredient: req.params.ingredientId });
  return ApiResponse.success(res, { message: "Ingredient transactions retrieved successfully", data: { transactions: result.transactions }, meta: result.meta });
});
export const getInventoryValue = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Inventory value retrieved successfully", data: await inventoryService.inventoryValue(),
}));
export const adjustInventory = asyncHandler(async (req, res) => {
  const result = await inventoryService.adjustStock({ ...req.body, performedBy: req.user._id });
  return ApiResponse.success(res, {
    message: `Inventory adjustment ${req.body.type.toLowerCase()} recorded successfully`,
    data: { ingredient: result.ingredient, currentStock: result.currentStock, unit: result.unit },
  });
});
export default { listInventory, getIngredientInventory, getLowStock, getExpiring, getTransactions, getIngredientTransactions, getInventoryValue, adjustInventory };
