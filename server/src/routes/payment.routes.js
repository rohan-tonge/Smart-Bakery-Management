import { Router } from "express";
import paymentController from "../controllers/payment.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { USER_ROLES as R } from "../utils/constants.js";
import {
  createPaymentSchema,
  verifyPaymentSchema,
  paymentIdSchema,
} from "../validators/payment.validator.js";

const router = Router();
const managers = [R.OWNER, R.MANAGER];
// Razorpay authenticates this endpoint by signature over req.rawBody, not by JWT.
router.post("/webhook", paymentController.webhook);
router.use(authenticateUser);
router.post(
  "/create",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ body: createPaymentSchema }),
  paymentController.create,
);
router.post(
  "/verify",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ body: verifyPaymentSchema }),
  paymentController.verify,
);
router.get(
  "/:id",
  authorizeRoles(R.CUSTOMER, ...managers),
  validateRequest({ params: paymentIdSchema }),
  paymentController.get,
);
export default router;
