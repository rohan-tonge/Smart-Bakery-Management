import { Router } from "express";
import purchaseController from "../controllers/purchase.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  createPurchaseSchema,
  purchaseParamsSchema,
  purchaseQuerySchema,
} from "../validators/purchase.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [USER_ROLES.OWNER, USER_ROLES.MANAGER];
router.use(authenticateUser, authorizeRoles(...managers));
router.get(
  "/",
  validateRequest({ query: purchaseQuerySchema }),
  purchaseController.listPurchases,
);
router.post(
  "/",
  validateRequest({ body: createPurchaseSchema }),
  purchaseController.createPurchase,
);
router.get(
  "/:id",
  validateRequest({ params: purchaseParamsSchema }),
  purchaseController.getPurchase,
);
export default router;
