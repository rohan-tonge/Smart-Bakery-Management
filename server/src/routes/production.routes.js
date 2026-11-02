import { Router } from "express";
import controller from "../controllers/production.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  batchCreateSchema,
  batchParamsSchema,
  batchQuerySchema,
  batchUpdateSchema,
  batchPlanSchema,
  completionSchema,
  packagingSchema,
  rejectionSchema,
  orderAssignmentSchema,
  batchReassignSchema,
  assignmentUpdateSchema,
  holdCreateSchema,
  holdUpdateInstructionSchema,
  holdAcknowledgeSchema,
  holdResolveSchema,
} from "../validators/worker.validator.js";
import { USER_ROLES } from "../utils/constants.js";
import costingController from "../controllers/costing.controller.js";
import { finalizeCostSchema } from "../validators/phase9.validator.js";
import { planCreateSchema, planDateQuerySchema, planParamsSchema, planUpdateSchema } from "../validators/planning.validator.js";
const router = Router();
const managers = [USER_ROLES.OWNER_MANAGER, USER_ROLES.OWNER, USER_ROLES.MANAGER];
const productionRoles = [...managers, USER_ROLES.PRODUCTION_STAFF];
router.use(authenticateUser);
router.post(
  "/plans",
  authorizeRoles(...managers),
  validateRequest({ body: planCreateSchema }),
  controller.createPlan,
);
router.get(
  "/plans",
  authorizeRoles(...managers),
  validateRequest({ query: planDateQuerySchema }),
  controller.listPlans,
);
router.get(
  "/plans/:id",
  authorizeRoles(...managers),
  validateRequest({ params: planParamsSchema }),
  controller.getPlan,
);
router.patch(
  "/plans/:id",
  authorizeRoles(...managers),
  validateRequest({ params: planParamsSchema, body: planUpdateSchema }),
  controller.updatePlan,
);
router.post(
  "/plans/:id/check-feasibility",
  authorizeRoles(...managers),
  validateRequest({ params: planParamsSchema }),
  controller.checkPlanFeasibility,
);
router.post(
  "/plans/:id/approve",
  authorizeRoles(...managers),
  validateRequest({ params: planParamsSchema }),
  controller.approvePlan,
);
router.post(
  "/orders/:id/assign",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema, body: orderAssignmentSchema }),
  controller.assignOrder,
);
router.get(
  "/team-status",
  authorizeRoles(...managers),
  controller.teamStatus,
);
router.get(
  "/recommendations",
  authorizeRoles(...managers),
  controller.recommendations,
);
router.get(
  "/orders/:id/recommendations",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema }),
  controller.orderRecommendations,
);
router.get(
  "/batches/:id/recommendations",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema }),
  controller.batchRecommendations,
);
router.post(
  "/batches/:id/reassign",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema, body: batchReassignSchema }),
  controller.reassign,
);
router.post(
  "/batches",
  authorizeRoles(...managers),
  validateRequest({ body: batchCreateSchema }),
  controller.create,
);
router.get(
  "/batches",
  authorizeRoles(...productionRoles),
  validateRequest({ query: batchQuerySchema }),
  controller.list,
);
router.get(
  "/batches/:id",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema }),
  controller.get,
);
router.patch(
  "/batches/:id",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema, body: batchUpdateSchema }),
  controller.update,
);
router.post(
  "/batches/:id/accept",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: batchPlanSchema }),
  controller.accept,
);
router.post(
  "/batches/:id/reject",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: rejectionSchema }),
  controller.reject,
);
router.post(
  "/batches/:id/verify",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: batchPlanSchema }),
  controller.verify,
);
router.post(
  "/batches/:id/start",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema }),
  controller.start,
);
router.post(
  "/batches/:id/consume",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema }),
  controller.consume,
);
router.post(
  "/batches/:id/complete",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: completionSchema }),
  controller.complete,
);
router.get(
  "/batches/:id/cost",
  authorizeRoles(USER_ROLES.OWNER),
  validateRequest({ params: batchParamsSchema }),
  costingController.getBatchCost,
);
router.patch(
  "/batches/:id/cost/draft",
  authorizeRoles(USER_ROLES.OWNER),
  validateRequest({ params: batchParamsSchema, body: finalizeCostSchema }),
  costingController.saveDraft,
);
router.post(
  "/batches/:id/cost/draft",
  authorizeRoles(USER_ROLES.OWNER),
  validateRequest({ params: batchParamsSchema, body: finalizeCostSchema }),
  costingController.saveDraft,
);
router.post(
  "/batches/:id/cost/finalize",
  authorizeRoles(USER_ROLES.OWNER),
  validateRequest({ params: batchParamsSchema, body: finalizeCostSchema }),
  costingController.finalize,
);
router.patch(
  "/batches/:id/assignment",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: assignmentUpdateSchema }),
  controller.updateAssignment,
);
router.post(
  "/batches/:id/package",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: packagingSchema }),
  controller.package,
);
router.post(
  "/batches/:id/finalize",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema }),
  controller.finalize,
);
router.post(
  "/batches/:id/deliver",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema }),
  controller.deliver,
);
router.post(
  "/batches/:id/cancel",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema }),
  controller.cancel,
);

router.post(
  "/batches/:id/hold",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema, body: holdCreateSchema }),
  controller.placeHold,
);

router.patch(
  "/batches/:id/hold",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema, body: holdUpdateInstructionSchema }),
  controller.updateHoldInstruction,
);

router.post(
  "/batches/:id/acknowledge-hold",
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchParamsSchema, body: holdAcknowledgeSchema }),
  controller.acknowledgeHold,
);

router.post(
  "/batches/:id/resolve-hold",
  authorizeRoles(...managers),
  validateRequest({ params: batchParamsSchema, body: holdResolveSchema }),
  controller.resolveHold,
);

export default router;
