import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import costingService from "../services/costing.service.js";
export default {
  getBatchCost: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { cost: await costingService.getBatchCost(req.params.id) } })),
  saveDraft: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Cost draft saved successfully", data: { cost: await costingService.saveDraft(req.params.id, req.body, req.user) } })),
  finalize: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production cost finalized", data: { cost: await costingService.finalize(req.params.id, req.body, req.user) } })),
  estimate: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await costingService.estimate(req.body) })),
  priceImpact: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await costingService.priceImpact(req.body) })),
  summary: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { summary: await costingService.summary(req.query) } })),
  orderProfitability: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { profitability: await costingService.orderProfitability(req.params.id) } })),
  batchProfitability: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { profitability: await costingService.batchProfitability(req.params.id) } })),
  productProfitability: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { profitability: await costingService.productProfitability(req.params.id) } })),
  variantProfitability: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { profitability: await costingService.variantProfitabilityById(req.params.id) } })),
};
