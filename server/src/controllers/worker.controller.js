import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import workerService from "../services/worker.service.js";
export default {
  create: asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Worker created successfully", data: { worker: await workerService.create(req.body) } })),
  list: asyncHandler(async (req, res) => { const result = await workerService.list(req.query); return ApiResponse.success(res, { data: { workers: result.workers }, meta: result.meta }); }),
  get: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await workerService.get(req.params.id) })),
  update: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { worker: await workerService.update(req.params.id, req.body) } })),
  remove: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Worker deactivated successfully", data: { worker: await workerService.deactivate(req.params.id) } })),
  meBatches: asyncHandler(async (req, res) => { const result = await workerService.ownBatches(req.user._id, req.query); return ApiResponse.success(res, { data: { batches: result.batches }, meta: result.meta }); }),
};
