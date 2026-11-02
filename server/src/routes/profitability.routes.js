import { Router } from "express";
import controller from "../controllers/costing.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { idParamsSchema } from "../validators/phase9.validator.js";
import { USER_ROLES } from "../utils/constants.js";
const router = Router();
router.use(
  authenticateUser,
  authorizeRoles(USER_ROLES.OWNER, USER_ROLES.MANAGER),
);
router.get(
  "/orders/:id",
  validateRequest({ params: idParamsSchema }),
  controller.orderProfitability,
);
router.get(
  "/batches/:id",
  validateRequest({ params: idParamsSchema }),
  controller.batchProfitability,
);
router.get(
  "/products/:id",
  validateRequest({ params: idParamsSchema }),
  controller.productProfitability,
);
router.get(
  "/variants/:id",
  validateRequest({ params: idParamsSchema }),
  controller.variantProfitability,
);
export default router;
