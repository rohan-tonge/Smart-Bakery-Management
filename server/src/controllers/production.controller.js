import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import productionService from "../services/production.service.js";
export default {
  create: asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Production batch planned successfully", data: { batch: await productionService.create(req.body, req.user) } })),
  assignOrder: asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Order assigned to production", data: { batches: await productionService.assignOrder(req.params.id, req.body.workers || req.body.worker, req.user, req.body.ownerInstructions) } })),
  createPlan: asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Production plan created", data: { plan: await productionService.createPlan(req.body, req.user) } })),
  listPlans: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { plans: await productionService.listPlans(req.query.date) } })),
  getPlan: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { plan: await productionService.getPlan(req.params.id) } })),
  updatePlan: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production plan updated and rechecked", data: { plan: await productionService.updatePlan(req.params.id, req.body) } })),
  checkPlanFeasibility: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { plan: await productionService.refreshPlanFeasibility(req.params.id) } })),
  approvePlan: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production plan approved", data: { plan: await productionService.approvePlan(req.params.id, req.user) } })),
  list: asyncHandler(async (req, res) => { const result = await productionService.list(req.query, req.user); return ApiResponse.success(res, { data: { batches: result.batches }, meta: result.meta }); }),
  get: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { batch: await productionService.get(req.params.id, req.user) } })),
  update: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { batch: await productionService.update(req.params.id, req.body) } })),
  accept: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Batch accepted for verification", data: { batch: await productionService.accept(req.params.id, req.body, req.user) } })),
  reject: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Batch assignment rejected", data: { batch: await productionService.reject(req.params.id, req.body, req.user) } })),
  verify: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Batch verified. Ingredients are ready for issue.", data: { batch: await productionService.verify(req.params.id, req.body, req.user) } })),
  start: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production started", data: { batch: await productionService.start(req.params.id, req.user, req.body) } })),
  consume: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Ingredients consumed", data: { batch: await productionService.consume(req.params.id, req.user) } })),
  complete: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Baking output recorded successfully; batch ready for packaging", data: { batch: await productionService.complete(req.params.id, req.body, req.user) } })),
  package: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Batch packaged", data: { batch: await productionService.package(req.params.id, req.body, req.user) } })),
  finalize: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production batch completed", data: { batch: await productionService.transition(req.params.id, "COMPLETED", req.user) } })),
  deliver: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { batch: await productionService.transition(req.params.id, "DELIVERED") } })),
  cancel: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { batch: await productionService.transition(req.params.id, "CANCELLED", req.user, req.body?.reason) } })),
  updateAssignment: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { batch: await productionService.updateAssignment(req.params.id, req.body.workerId || req.user._id, req.body, req.user) } })),
  reassign: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Batch reassigned successfully", data: { batch: await productionService.reassignBatch(req.params.id, req.body, req.user) } })),
  teamStatus: asyncHandler(async (req, res) => {
    const teamStatus = await productionService.getWorkersWorkloadStatus();
    return ApiResponse.success(res, { data: { teamStatus, bakers: teamStatus, workers: teamStatus } });
  }),
  recommendations: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await productionService.recommendWorkers({ orderId: req.query.orderId || req.body?.orderId, batchId: req.query.batchId || req.body?.batchId }) })),
  orderRecommendations: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await productionService.recommendWorkers({ orderId: req.params.id }) })),
  batchRecommendations: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await productionService.recommendWorkers({ batchId: req.params.id }) })),
  placeHold: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production batch placed on emergency hold", data: { batch: await productionService.placeHold(req.params.id, req.body, req.user) } })),
  updateHoldInstruction: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Hold instruction updated", data: { batch: await productionService.updateHoldInstruction(req.params.id, req.body, req.user) } })),
  acknowledgeHold: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production hold acknowledged", data: { batch: await productionService.acknowledgeHold(req.params.id, req.body, req.user) } })),
  resolveHold: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Production hold resolved", data: { batch: await productionService.resolveHold(req.params.id, req.body, req.user) } })),
};
