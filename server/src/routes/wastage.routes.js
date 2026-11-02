import { Router } from "express";
import controller from "../controllers/wastage.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  idParamsSchema,
  wastageCreateSchema,
  wastageQuerySchema,
} from "../validators/phase9.validator.js";
import { USER_ROLES } from "../utils/constants.js";
const router = Router();
const managers = [USER_ROLES.OWNER, USER_ROLES.MANAGER];
router.use(authenticateUser);
router.post(
  "/",
  authorizeRoles(...managers, USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ body: wastageCreateSchema }),
  controller.create,
);
router.get(
  "/summary",
  authorizeRoles(...managers),
  validateRequest({ query: wastageQuerySchema }),
  controller.summary,
);
router.get(
  "/",
  authorizeRoles(...managers, USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ query: wastageQuerySchema }),
  controller.list,
);
router.get(
  "/:id",
  authorizeRoles(...managers, USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ params: idParamsSchema }),
  controller.get,
);
export default router;
