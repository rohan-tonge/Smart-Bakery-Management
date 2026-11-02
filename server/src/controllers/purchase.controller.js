import purchaseService from "../services/purchase.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const createPurchase = asyncHandler(async (req, res) => ApiResponse.created(res, {
  message: "Purchase recorded successfully",
  data: { purchase: await purchaseService.create(req.body, req.user._id) },
}));
export const listPurchases = asyncHandler(async (req, res) => {
  const result = await purchaseService.list(req.query);
  return ApiResponse.success(res, { message: "Purchases retrieved successfully", data: { purchases: result.purchases }, meta: result.meta });
});
export const getPurchase = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Purchase retrieved successfully", data: { purchase: await purchaseService.getById(req.params.id) },
}));
export default { createPurchase, listPurchases, getPurchase };
