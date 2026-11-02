import { Router } from "express";
import controller from "../controllers/requisition.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  requisitionCreateSchema,
  requisitionApproveSchema,
  requisitionRejectSchema,
  requisitionParamsSchema,
  batchRequisitionParamsSchema,
  requisitionQuerySchema,
} from "../validators/requisition.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [
  USER_ROLES.OWNER_MANAGER,
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
  "OWNER",
  "MANAGER",
];
const productionRoles = [...managers, USER_ROLES.PRODUCTION_STAFF];

router.use(authenticateUser);

// List requisitions (Managers see all, Staff see their own)
router.get(
  "/",
  authorizeRoles(...productionRoles),
  validateRequest({ query: requisitionQuerySchema }),
  controller.list,
);

// Calculate batch recipe requirements (Normalized units, operational stock info, no financials)
router.get(
  ["/batches/:id/requirements", "/batch/:id/requirements"],
  authorizeRoles(...productionRoles),
  validateRequest({ params: batchRequisitionParamsSchema }),
  controller.getBatchRequirements,
);

// Staff submits ingredient requisition for an accepted batch
router.post(
  ["/batches/:id", "/batch/:id"],
  authorizeRoles(...productionRoles),
  validateRequest({
    params: batchRequisitionParamsSchema,
    body: requisitionCreateSchema,
  }),
  controller.create,
);

// Get single requisition details
router.get(
  "/:id",
  authorizeRoles(...productionRoles),
  validateRequest({ params: requisitionParamsSchema }),
  controller.get,
);

// Manager approves requisition
router.post(
  "/:id/approve",
  authorizeRoles(...managers),
  validateRequest({
    params: requisitionParamsSchema,
    body: requisitionApproveSchema,
  }),
  controller.approve,
);

// Manager rejects requisition with reason
router.post(
  "/:id/reject",
  authorizeRoles(...managers),
  validateRequest({
    params: requisitionParamsSchema,
    body: requisitionRejectSchema,
  }),
  controller.reject,
);

// Manager issues ingredients (physical handover & FIFO stock deduction)
router.post(
  "/:id/issue",
  authorizeRoles(...managers),
  validateRequest({
    params: requisitionParamsSchema,
  }),
  controller.issue,
);

export default router;
