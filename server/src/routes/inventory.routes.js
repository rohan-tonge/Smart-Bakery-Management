import { Router } from "express";
import inventoryController from "../controllers/inventory.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  adjustmentSchema,
  expiringQuerySchema,
  ingredientInventoryParamsSchema,
  inventoryQuerySchema,
  transactionsQuerySchema,
} from "../validators/inventory.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [USER_ROLES.OWNER, USER_ROLES.MANAGER];
router.use(authenticateUser, authorizeRoles(...managers));
router.get("/value", authorizeRoles(USER_ROLES.OWNER), inventoryController.getInventoryValue);
router.get(
  "/low-stock",
  validateRequest({ query: inventoryQuerySchema }),
  inventoryController.getLowStock,
);
router.get(
  "/expiring",
  validateRequest({ query: expiringQuerySchema }),
  inventoryController.getExpiring,
);
router.get(
  "/transactions",
  validateRequest({ query: transactionsQuerySchema }),
  inventoryController.getTransactions,
);
router.get(
  "/transactions/:ingredientId",
  validateRequest({
    params: ingredientInventoryParamsSchema,
    query: inventoryQuerySchema,
  }),
  inventoryController.getIngredientTransactions,
);
router.post(
  "/adjustments",
  validateRequest({ body: adjustmentSchema }),
  inventoryController.adjustInventory,
);
router.get(
  "/:ingredientId",
  validateRequest({
    params: ingredientInventoryParamsSchema,
    query: inventoryQuerySchema,
  }),
  inventoryController.getIngredientInventory,
);
router.get(
  "/",
  validateRequest({ query: inventoryQuerySchema }),
  inventoryController.listInventory,
);
export default router;
