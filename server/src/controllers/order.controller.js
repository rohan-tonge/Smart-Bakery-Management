import orderService from "../services/order.service.js";
import { orderFeasibilityService } from "../services/order-feasibility.service.js";
import deliverySlotService from "../services/deliverySlot.service.js";
import Cart from "../models/cart.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import AppError from "../utils/appError.js";
import FinishedProductStock from "../models/finishedProductStock.model.js";
import Product from "../models/product.model.js";
import paymentService from "../services/payment.service.js";
import { USER_ROLES } from "../utils/constants.js";

const managers = [
  USER_ROLES.OWNER_MANAGER,
  USER_ROLES.OWNER,
  USER_ROLES.MANAGER,
];

export default {
  feasibility: asyncHandler(async (req, res) => {
    const isManagerRole =
      req.user && managers.includes(req.user.role);
    return ApiResponse.success(res, {
      data: await orderFeasibilityService.check(req.body.items, {
        detailed: isManagerRole,
      }),
    });
  }),

  create: asyncHandler(async (req, res) => {
    const customer = req.user?._id || null;
    const guestId =
      req.headers["x-guest-id"] || req.query.guestId || req.body?.guestId;
    const body = {
      ...req.body,
      guestId: req.body?.guestId || (guestId ? String(guestId).trim() : undefined),
    };
    const order = await orderService.checkout(
      customer,
      body,
      req.get("Idempotency-Key") || req.get("X-Idempotency-Key") || req.headers["idempotency-key"] || req.headers["x-idempotency-key"],
    );
    const message = order.paymentMethod === "MANUAL_UPI"
      ? "Order reserved. Scan the bakery QR and submit your payment reference for verification."
      : "Order created and awaiting provider payment";
    return ApiResponse.created(res, {
      message,
      data: { order },
    });
  }),

  track: asyncHandler(async (req, res) => {
    const orderNumber = req.query.orderNumber || req.body?.orderNumber;
    const phone = req.query.phone || req.body?.phone;
    const token = req.query.token || req.body?.token;
    const trackingData = await orderService.trackGuestOrder({
      orderNumber,
      phone,
      token,
    });
    return ApiResponse.success(res, {
      message: "Order tracking details retrieved successfully",
      data: trackingData,
    });
  }),

  deliverySlots: asyncHandler(async (req, res) => {
    const orderType = req.method === "POST" ? (req.body?.orderType || "DELIVERY") : (req.query?.orderType || "DELIVERY");
    let items = req.method === "POST" ? req.body?.items : undefined;

    if (!items || items.length === 0) {
      const cart = req.user
        ? await Cart.findOne({ customer: req.user._id })
        : req.body?.guestId || req.query?.guestId
          ? await Cart.findOne({ guestId: req.body?.guestId || req.query?.guestId })
          : null;
      if (cart?.items?.length) {
        items = cart.items.map((x) => ({
          productId: x.product,
          variantId: x.variant,
          quantity: x.quantity,
        }));
      }
    }

    const slotsData = await deliverySlotService.getAvailableSlots({
      items: items || [],
      orderType,
    });

    return ApiResponse.success(res, {
      message: "Available delivery time slots retrieved successfully",
      data: slotsData,
    });
  }),

  markPaid: asyncHandler(async (req, res) => {
    const order = await orderService.markCustomerPaid(req.params.id, {
      screenshot: req.body?.screenshot,
      mimeType: req.body?.mimeType,
      fileName: req.body?.fileName,
      paymentReference:
        req.body?.paymentReference || req.body?.transactionReference,
      amount: req.body?.amount,
      token: req.body?.token || req.body?.trackingToken,
      isReturningCustomer: req.body?.isReturningCustomer,
      user: req.user,
    });
    return ApiResponse.success(res, {
      message:
        "Payment screenshot submitted and awaiting verification by bakery owner/manager.",
      data: { order },
    });
  }),

  getPaymentProof: asyncHandler(async (req, res) => {
    const proof = await orderService.getPaymentProof(
      req.params.id,
      req.user,
      req.query?.token || req.headers["x-guest-token"],
    );

    res.setHeader("Content-Type", proof.mimeType);
    res.setHeader("Content-Length", String(proof.fileSize || proof.data.length));
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.setHeader("Content-Disposition", `inline; filename="${proof.fileName}"`);
    res.setHeader("X-Payment-Proof-File-Name", proof.fileName || "");
    res.setHeader("X-Payment-Proof-Mime-Type", proof.mimeType || "");
    res.setHeader("X-Payment-Proof-Size", String(proof.fileSize || proof.data.length));
    if (proof.uploadedAt) {
      res.setHeader("X-Payment-Proof-Uploaded-At", new Date(proof.uploadedAt).toISOString());
    }
    return res.send(proof.data);
  }),

  checkInventory: asyncHandler(async (req, res) => {
    const check = await orderFeasibilityService.checkOrder(req.params.id, { detailed: true });
    return ApiResponse.success(res, { data: check });
  }),

  fulfillFromStock: asyncHandler(async (req, res) => {
    const order = await orderService.fulfillFromStock(req.params.id, req.user);
    return ApiResponse.success(res, {
      message: `Order ${order.orderNumber} successfully fulfilled from available finished stock`,
      data: { order },
    });
  }),

  confirmPayment: asyncHandler(async (req, res) => {
    const order = await orderService.confirmPayment(
      req.params.id,
      req.user._id,
      req.body?.note,
    );
    return ApiResponse.success(res, {
      message: "Payment confirmed successfully by bakery owner/manager",
      data: { order },
    });
  }),

  rejectPayment: asyncHandler(async (req, res) => {
    const order = await orderService.rejectPayment(
      req.params.id,
      req.user._id,
      req.body?.note,
    );
    return ApiResponse.success(res, {
      message: "Payment reference rejected and order cancelled",
      data: { order },
    });
  }),

  my: asyncHandler(async (req, res) => {
    const result = await orderService.list({
      ...req.query,
      customer: req.user._id,
    });
    return ApiResponse.success(res, {
      data: { orders: result.orders },
      meta: result.meta,
    });
  }),

  list: asyncHandler(async (req, res) => {
    const result = await orderService.list(req.query);
    return ApiResponse.success(res, {
      data: { orders: result.orders },
      meta: result.meta,
    });
  }),

  getMine: asyncHandler(async (req, res) => {
    if (![...managers, USER_ROLES.CUSTOMER].includes(req.user.role))
      throw AppError.forbidden("Order access is not available for this role");
    const order = await orderService.get(
      req.params.id,
      req.user.role === USER_ROLES.CUSTOMER ? req.user._id : null,
    );
    return ApiResponse.success(res, {
      data: {
        order,
        payment: await paymentService.summaryForOrder(order._id),
      },
    });
  }),

  cancelMine: asyncHandler(async (req, res) => {
    if (![...managers, USER_ROLES.CUSTOMER].includes(req.user.role))
      throw AppError.forbidden("Order cancellation is not available for this role");
    const order = await orderService.cancel(
      req.params.id,
      req.user.role === USER_ROLES.CUSTOMER ? req.user._id : null,
      req.user._id,
      req.body.reason || "",
    );
    await paymentService.cancelOpenAttempts(
      order._id,
      req.body.reason || "Order cancelled",
    );
    return ApiResponse.success(res, { data: { order } });
  }),

  status: asyncHandler(async (req, res) => {
    const order = await orderService.updateStatus(
      req.params.id,
      req.body.status,
      req.user._id,
    );
    if (["CANCELLED", "EXPIRED"].includes(order.status))
      await paymentService.cancelOpenAttempts(
        order._id,
        `Order ${order.status.toLowerCase()}`,
      );
    return ApiResponse.success(res, { data: { order } });
  }),

  setFinishedStock: asyncHandler(async (req, res) => {
    const { productId, variantId, onHandQuantity } = req.body;
    const product = await Product.findById(productId);
    if (!product?.variants.id(variantId))
      throw AppError.badRequest(
        "Variant does not belong to the specified product",
      );
    let stock = await FinishedProductStock.findOne({
      product: productId,
      variant: variantId,
    });
    if (stock) {
      if (onHandQuantity < stock.reservedQuantity)
        throw AppError.conflict(
          "On-hand quantity cannot be less than already reserved stock",
        );
      stock.onHandQuantity = onHandQuantity;
      stock.updatedBy = req.user._id;
      await stock.save();
    } else {
      stock = await FinishedProductStock.create({
        product: productId,
        variant: variantId,
        onHandQuantity,
        reservedQuantity: 0,
        updatedBy: req.user._id,
      });
    }
    return ApiResponse.success(res, { data: { stock } });
  }),

  reorder: asyncHandler(async (req, res) =>
    ApiResponse.success(res, {
      data: await orderService.reorder(req.params.id, req.user._id),
    }),
  ),

  placeHold: asyncHandler(async (req, res) => {
    const result = await orderService.placeOrderOnHold(req.params.id, req.body, req.user);
    return ApiResponse.success(res, {
      message: "Order placed on emergency production hold",
      data: result,
    });
  }),

  cancelFromHold: asyncHandler(async (req, res) => {
    const order = await orderService.cancelFromProductionHold(
      req.params.id,
      req.user,
      req.body?.reason || "Cancelled while on production hold"
    );
    await paymentService.cancelOpenAttempts(
      order._id,
      req.body?.reason || "Cancelled while on production hold"
    );
    return ApiResponse.success(res, {
      message: "Order cancelled successfully from production hold",
      data: { order },
    });
  }),
};
