import { Router } from "express";
import workerController from "../controllers/worker.controller.js";
import productionController from "../controllers/production.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  workerCreateSchema,
  workerParamsSchema,
  workerQuerySchema,
  workerUpdateSchema,
  batchParamsSchema,
  assignmentUpdateSchema,
} from "../validators/worker.validator.js";
import { USER_ROLES } from "../utils/constants.js";
const router = Router();
const managers = [USER_ROLES.OWNER, USER_ROLES.MANAGER];
const productionRoles = [...managers, USER_ROLES.PRODUCTION_STAFF];
router.use(authenticateUser);
router.get(
  "/workload-status",
  authorizeRoles(...managers),
  productionController.teamStatus,
);
router.get(
  "/me/batches",
  authorizeRoles(USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ query: workerQuerySchema }),
  workerController.meBatches,
);
router.post(
  "/",
  authorizeRoles(...managers),
  validateRequest({ body: workerCreateSchema }),
  workerController.create,
);
router.get(
  "/",
  authorizeRoles(...managers),
  validateRequest({ query: workerQuerySchema }),
  workerController.list,
);
router.get(
  "/:id",
  authorizeRoles(...managers),
  validateRequest({ params: workerParamsSchema }),
  workerController.get,
);
router.patch(
  "/:id",
  authorizeRoles(...managers),
  validateRequest({ params: workerParamsSchema, body: workerUpdateSchema }),
  workerController.update,
);
router.delete(
  "/:id",
  authorizeRoles(...managers),
  validateRequest({ params: workerParamsSchema }),
  workerController.remove,
);
router.patch(
  "/batches/:id/assignment",
  authorizeRoles(USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ params: batchParamsSchema, body: assignmentUpdateSchema }),
  productionController.updateAssignment,
);
export default router;
