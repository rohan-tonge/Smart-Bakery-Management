import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import wastageService from "../services/wastage.service.js";
export default {
  create: asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Wastage recorded successfully", data: { wastage: await wastageService.create(req.body, req.user) } })),
  list: asyncHandler(async (req, res) => { const result = await wastageService.list(req.query, req.user); return ApiResponse.success(res, { data: { wastage: result.records }, meta: result.meta }); }),
  get: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { wastage: await wastageService.get(req.params.id, req.user) } })),
  summary: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { summary: await wastageService.summary(req.query) } })),
};
