import { Router } from "express";
import userController from "../controllers/user.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  updateRoleSchema,
  updateStatusSchema,
  userQuerySchema,
} from "../validators/user.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();

// All user management routes require authentication
router.use(authenticateUser);

// List users (OWNER, MANAGER)
router.get(
  "/",
  authorizeRoles(USER_ROLES.OWNER, USER_ROLES.MANAGER),
  validateRequest({ query: userQuerySchema }),
  userController.getUsers,
);

// Get user by ID (OWNER, MANAGER, or self)
router.get("/:id", userController.getUserById);

// Update user active status (OWNER, MANAGER)
router.patch(
  "/:id/status",
  authorizeRoles(USER_ROLES.OWNER, USER_ROLES.MANAGER),
  validateRequest({ body: updateStatusSchema }),
  userController.updateUserStatus,
);

// Update user role (OWNER only!)
router.patch(
  "/:id/role",
  authorizeRoles(USER_ROLES.OWNER),
  validateRequest({ body: updateRoleSchema }),
  userController.updateUserRole,
);

export default router;
