import { Router } from "express";
import settingController from "../controllers/setting.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { USER_ROLES } from "../utils/constants.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { capacityConfigSchema } from "../validators/capacity.validator.js";

const router = Router();

// Public: Customers fetch owner payment QR for checkout
router.get("/payment-qr", settingController.getPaymentQr);

// Protected: OWNER_MANAGER updates owner payment QR
router.put(
  "/payment-qr",
  authenticateUser,
  authorizeRoles(USER_ROLES.OWNER),
  settingController.updatePaymentQr
);

router.get("/production-capacity", authenticateUser, authorizeRoles(USER_ROLES.OWNER_MANAGER), settingController.getProductionCapacity);
router.put(
  "/production-capacity",
  authenticateUser,
  authorizeRoles(USER_ROLES.OWNER_MANAGER),
  validateRequest({ body: capacityConfigSchema }),
  settingController.updateProductionCapacity,
);

export default router;
