import { Router } from "express";
import recipeController from "../controllers/recipe.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  calculateRecipeSchema,
  createRecipeSchema,
  recipeParamsSchema,
  updateRecipeSchema,
} from "../validators/recipe.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [
  USER_ROLES.OWNER_MANAGER,
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
];
const recipeReaders = [...managers, USER_ROLES.PRODUCTION_STAFF];
router.post(
  "/recipes/calculate",
  authenticateUser,
  authorizeRoles(...recipeReaders),
  validateRequest({ body: calculateRecipeSchema }),
  recipeController.calculateRecipe,
);
router.post(
  "/products/:productId/variants/:variantId/recipe",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: recipeParamsSchema, body: createRecipeSchema }),
  recipeController.createRecipe,
);
router.get(
  "/products/:productId/variants/:variantId/recipe",
  authenticateUser,
  authorizeRoles(...recipeReaders),
  validateRequest({ params: recipeParamsSchema }),
  recipeController.getRecipe,
);
router.patch(
  "/products/:productId/variants/:variantId/recipe",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: recipeParamsSchema, body: updateRecipeSchema }),
  recipeController.updateRecipe,
);
router.delete(
  "/products/:productId/variants/:variantId/recipe",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: recipeParamsSchema }),
  recipeController.deleteRecipe,
);

export default router;
