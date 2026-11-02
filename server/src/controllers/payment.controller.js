import paymentService from "../services/payment.service.js";
import Payment from "../models/payment.model.js";
import ApiResponse from "../utils/apiResponse.js";
import AppError from "../utils/appError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { USER_ROLES } from "../utils/constants.js";

const managers = [
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
  USER_ROLES.OWNER_MANAGER,
];
export default {
  create: asyncHandler(async (req, res) => ApiResponse.created(res, { message: "Razorpay checkout order created", data: await paymentService.create(req.user._id, req.body.orderId) })),
  verify: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Payment verification completed", data: { payment: await paymentService.verify(req.user._id, req.body) } })),
  webhook: asyncHandler(async (req, res) => ApiResponse.success(res, { message: "Webhook received", data: await paymentService.handleWebhook({ rawBody: req.rawBody, signature: req.get("x-razorpay-signature"), eventId: req.get("x-razorpay-event-id"), body: req.body }) })),
  get: asyncHandler(async (req, res) => {
    if (![...managers, USER_ROLES.CUSTOMER].includes(req.user.role)) throw AppError.forbidden("Payment access is not available for this role");
    return ApiResponse.success(res, { data: { payment: await paymentService.get(req.params.id, req.user) } });
  }),
};
