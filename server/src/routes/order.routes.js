import { Router } from "express";
import orderController from "../controllers/order.controller.js";
import productionController from "../controllers/production.controller.js";
import {
  authenticateUser,
  optionalAuthenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { USER_ROLES as R } from "../utils/constants.js";
import {
  feasibilitySchema,
  checkoutSchema,
  deliverySlotsSchema,
  listSchema,
  idSchema,
  statusSchema,
  cancelSchema,
  finishedStockSchema,
  trackOrderSchema,
  markPaidSchema,
  confirmPaymentSchema,
} from "../validators/order.validator.js";
import { orderAssignmentSchema, holdCreateSchema } from "../validators/worker.validator.js";

const router = Router();
const managers = [R.OWNER_MANAGER, R.OWNER, R.MANAGER];

// Public & Optional Auth Routes
router.get(
  "/delivery-slots",
  optionalAuthenticateUser,
  orderController.deliverySlots,
);

router.post(
  "/delivery-slots",
  optionalAuthenticateUser,
  validateRequest({ body: deliverySlotsSchema }),
  orderController.deliverySlots,
);

router.post(
  "/check-feasibility",
  optionalAuthenticateUser,
  validateRequest({ body: feasibilitySchema }),
  orderController.feasibility,
);

router.post(
  "/",
  optionalAuthenticateUser,
  validateRequest({ body: checkoutSchema }),
  orderController.create,
);

router.get(
  "/track",
  validateRequest({ query: trackOrderSchema }),
  orderController.track,
);

router.post(
  "/:id/mark-paid",
  optionalAuthenticateUser,
  validateRequest({ params: idSchema, body: markPaidSchema }),
  orderController.markPaid,
);

router.get(
  "/:id/payment-proof",
  optionalAuthenticateUser,
  validateRequest({ params: idSchema }),
  orderController.getPaymentProof,
);

// Authenticated Routes
router.use(authenticateUser);

router.get(
  "/my",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ query: listSchema }),
  orderController.my,
);

router.post(
  "/:id/reorder",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ params: idSchema }),
  orderController.reorder,
);

// Protected Management Routes
router.get(
  "/",
  authorizeRoles(...managers),
  validateRequest({ query: listSchema }),
  orderController.list,
);

router.put(
  "/finished-stock",
  authorizeRoles(...managers),
  validateRequest({ body: finishedStockSchema }),
  orderController.setFinishedStock,
);

router.patch(
  "/:id/status",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema, body: statusSchema }),
  orderController.status,
);

router.get(
  "/:id/inventory-check",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema }),
  orderController.checkInventory,
);

router.post(
  "/:id/fulfill-from-stock",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema }),
  orderController.fulfillFromStock,
);

router.patch(
  "/:id/confirm-payment",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema, body: confirmPaymentSchema }),
  orderController.confirmPayment,
);

router.patch(
  "/:id/reject-payment",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema, body: confirmPaymentSchema }),
  orderController.rejectPayment,
);

router.post(
  "/:id/assign",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema, body: orderAssignmentSchema }),
  productionController.assignOrder,
);

router.post(
  "/:id/hold",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema, body: holdCreateSchema }),
  orderController.placeHold,
);

router.post(
  "/:id/cancel-hold",
  authorizeRoles(...managers),
  validateRequest({ params: idSchema }),
  orderController.cancelFromHold,
);

router.get(
  "/:id",
  validateRequest({ params: idSchema }),
  orderController.getMine,
);

router.post(
  "/:id/cancel",
  validateRequest({ params: idSchema, body: cancelSchema }),
  orderController.cancelMine,
);

export default router;
