import { Router } from "express";
import ingredientController from "../controllers/ingredient.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  createIngredientSchema,
  updateIngredientSchema,
  ingredientParamsSchema,
  ingredientQuerySchema,
} from "../validators/ingredient.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [USER_ROLES.OWNER, USER_ROLES.MANAGER];
router.use(authenticateUser);
router.get(
  "/",
  authorizeRoles(...managers, USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ query: ingredientQuerySchema }),
  ingredientController.listIngredients,
);
router.get(
  "/:id",
  authorizeRoles(...managers, USER_ROLES.PRODUCTION_STAFF),
  validateRequest({ params: ingredientParamsSchema }),
  ingredientController.getIngredient,
);
router.post(
  "/",
  authorizeRoles(...managers),
  validateRequest({ body: createIngredientSchema }),
  ingredientController.createIngredient,
);
router.patch(
  "/:id",
  authorizeRoles(...managers),
  validateRequest({
    params: ingredientParamsSchema,
    body: updateIngredientSchema,
  }),
  ingredientController.updateIngredient,
);
router.delete(
  "/:id",
  authorizeRoles(...managers),
  validateRequest({ params: ingredientParamsSchema }),
  ingredientController.deleteIngredient,
);
export default router;
