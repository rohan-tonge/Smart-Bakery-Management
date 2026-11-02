import { Router } from "express";
import productController from "../controllers/product.controller.js";
import {
  authenticateUser,
  optionalAuthenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  createProductSchema,
  updateProductSchema,
  variantSchema,
  updateVariantSchema,
  productParamsSchema,
  variantParamsSchema,
  productQuerySchema,
} from "../validators/product.validator.js";
import { USER_ROLES } from "../utils/constants.js";

const router = Router();
const managers = [USER_ROLES.OWNER_MANAGER];

// Public read routes with optional authentication
router.get(
  "/:productId/feedback-summary",
  optionalAuthenticateUser,
  validateRequest({ params: productParamsSchema }),
  productController.feedbackSummary,
);
router.get(
  "/",
  optionalAuthenticateUser,
  validateRequest({ query: productQuerySchema }),
  productController.listProducts,
);
router.get(
  "/:productId/variants",
  optionalAuthenticateUser,
  validateRequest({ params: productParamsSchema }),
  productController.listVariants,
);
router.get(
  "/:productId/variants/:variantId",
  optionalAuthenticateUser,
  validateRequest({ params: variantParamsSchema }),
  productController.getVariant,
);
router.get(
  "/:productId",
  optionalAuthenticateUser,
  validateRequest({ params: productParamsSchema }),
  productController.getProduct,
);

// Protected management routes
router.post(
  "/",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ body: createProductSchema }),
  productController.createProduct,
);
router.post(
  "/:productId/variants",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: productParamsSchema, body: variantSchema }),
  productController.createVariant,
);
router.patch(
  "/:productId/variants/:variantId",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: variantParamsSchema, body: updateVariantSchema }),
  productController.updateVariant,
);
router.delete(
  "/:productId/variants/:variantId",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: variantParamsSchema }),
  productController.deleteVariant,
);
router.patch(
  "/:productId",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: productParamsSchema, body: updateProductSchema }),
  productController.updateProduct,
);
router.get(
  "/:productId/costing",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: productParamsSchema }),
  productController.getProductCosting,
);
router.delete(
  "/:productId",
  authenticateUser,
  authorizeRoles(...managers),
  validateRequest({ params: productParamsSchema }),
  productController.deleteProduct,
);

export default router;
