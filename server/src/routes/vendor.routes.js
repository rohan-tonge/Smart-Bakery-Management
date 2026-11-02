import { Router } from "express";
import vendorController from "../controllers/vendor.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  createVendorSchema,
  updateVendorSchema,
  vendorParamsSchema,
  vendorQuerySchema,
} from "../validators/vendor.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [USER_ROLES.OWNER, USER_ROLES.MANAGER];
router.use(authenticateUser, authorizeRoles(...managers));
router.get(
  "/",
  validateRequest({ query: vendorQuerySchema }),
  vendorController.listVendors,
);
router.post(
  "/",
  validateRequest({ body: createVendorSchema }),
  vendorController.createVendor,
);
router.get(
  "/:id",
  validateRequest({ params: vendorParamsSchema }),
  vendorController.getVendor,
);
router.patch(
  "/:id",
  validateRequest({ params: vendorParamsSchema, body: updateVendorSchema }),
  vendorController.updateVendor,
);
router.delete(
  "/:id",
  validateRequest({ params: vendorParamsSchema }),
  vendorController.deleteVendor,
);
export default router;
