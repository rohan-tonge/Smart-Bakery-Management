import { Router } from "express";
import categoryController from "../controllers/category.controller.js";
import {
  authenticateUser,
  optionalAuthenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  createCategorySchema,
  updateCategorySchema,
  idParamsSchema,
} from "../validators/category.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [USER_ROLES.OWNER_MANAGER];

// Public read routes
router.get("/", optionalAuthenticateUser, categoryController.listCategories);
router.get(
  "/:id",
  optionalAuthenticateUser,
  validateRequest({ params: idParamsSchema }),
  categoryController.getCategory,
);

// Protected management routes
router.post(
  "/",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ body: createCategorySchema }),
  categoryController.createCategory,
);
router.patch(
  "/:id",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: idParamsSchema, body: updateCategorySchema }),
  categoryController.updateCategory,
);
router.delete(
  "/:id",
  authenticateUser,
  authorizeRoles(USER_ROLES.OWNER),
  validateRequest({ params: idParamsSchema }),
  categoryController.deleteCategory,
);
export default router;
