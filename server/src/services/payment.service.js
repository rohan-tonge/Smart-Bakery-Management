import crypto from "node:crypto";
import config from "../config/config.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import PaymentEvent from "../models/paymentEvent.model.js";
import { orderService } from "./order.service.js";
import AppError from "../utils/appError.js";
import { notificationService } from "./notification.service.js";

const toSubunits = (amount) => {
  if (!Number.isFinite(amount) || amount <= 0)
    throw AppError.badRequest("Order total must be greater than zero");
  const match = amount.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match)
    throw AppError.badRequest("Order total is outside supported payment range");
  let value = BigInt(`${match[1]}${match[2] || ""}`);
  let scale = (match[2]?.length || 0) - Number(match[3] || 0);
  while (scale > 2 && value % 10n === 0n) {
    value /= 10n;
    scale -= 1;
  }
  if (scale > 2)
    throw AppError.badRequest(
      "Order total cannot contain fractions smaller than one paise",
    );
  if (scale < 2) value *= 10n ** BigInt(2 - scale);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 1n)
    throw AppError.badRequest("Order total is outside supported payment range");
  return Number(value);
};
const safeEqualHex = (expected, actual) => {
  if (!/^[a-f\d]{64}$/i.test(actual || "")) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const publicPayment = (payment) => ({
  _id: payment._id,
  order: payment.order,
  provider: payment.provider,
  providerOrderId: payment.providerOrderId,
  providerPaymentId: payment.providerPaymentId,
  amount: payment.amount,
  currency: payment.currency,
  status: payment.status,
  method: payment.method,
  failureReason: payment.failureReason,
  capturedAt: payment.capturedAt,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

class RazorpayRestClient {
  constructor(credentials = config.razorpay) {
    this.credentials = credentials;
  }
  async request(path, { method = "GET", body } = {}) {
    const { keyId, keySecret, apiBaseUrl } = this.credentials;
    const authorization = Buffer.from(`${keyId}:${keySecret}`).toString(
      "base64",
    );
    const response = await fetch(`${apiBaseUrl}/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw AppError.unprocessableEntity(
        "Payment provider could not complete the request",
      );
    return result;
  }
  createOrder(data) {
    return this.request("/orders", { method: "POST", body: data });
  }
  fetchPayment(paymentId) {
    return this.request(`/payments/${encodeURIComponent(paymentId)}`);
  }
}

let gateway = new RazorpayRestClient();
let credentials = config.razorpay;

class PaymentService {
  /** Test seam for deterministic provider tests; never populate it with production secrets. */
  setGatewayForTests(testGateway, testCredentials) {
    gateway = testGateway;
    credentials = { ...credentials, ...testCredentials };
  }
  resetGateway() {
    credentials = config.razorpay;
    gateway = new RazorpayRestClient(credentials);
  }
  requireEnabled({ webhook = false } = {}) {
    if (
      !credentials.keyId ||
      !credentials.keySecret ||
      (webhook && !credentials.webhookSecret)
    )
      throw AppError.unprocessableEntity("Razorpay is not configured");
  }
  async create(customerId, orderId) {
    this.requireEnabled();
    await orderService.expirePending();
    await this.cancelExpiredAttempts();
    const order = await Order.findOne({ _id: orderId, customer: customerId });
    if (!order) throw AppError.notFound("Order not found");
    if (order.status !== "PENDING_PAYMENT")
      throw AppError.conflict("Order is not awaiting payment");
    if (!order.reservationExpiresAt || order.reservationExpiresAt <= new Date())
      throw AppError.conflict("Order payment reservation has expired");
    const amount = toSubunits(order.total);
    const active = await Payment.findOne({ activeOrderKey: String(order._id) });
    if (active) {
      if (!active.providerOrderId)
        throw AppError.conflict(
          "Payment order is being created; retry shortly",
        );
      return this.checkoutResponse(active);
    }
    let payment;
    try {
      payment = await Payment.create({
        order: order._id,
        customer: customerId,
        amount,
        currency: credentials.currency || "INR",
        status: "CREATED",
        activeOrderKey: String(order._id),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const concurrent = await Payment.findOne({
        activeOrderKey: String(order._id),
      });
      if (concurrent?.providerOrderId) return this.checkoutResponse(concurrent);
      throw AppError.conflict("Payment order is being created; retry shortly");
    }
    try {
      const razorpayOrder = await gateway.createOrder({
        amount,
        currency: payment.currency,
        receipt: order.orderNumber,
        notes: {
          bakery_order_id: String(order._id),
          bakery_payment_id: String(payment._id),
        },
      });
      if (
        !razorpayOrder?.id ||
        Number(razorpayOrder.amount) !== amount ||
        razorpayOrder.currency !== payment.currency
      )
        throw AppError.internal("Razorpay returned an invalid order response");
      payment.providerOrderId = razorpayOrder.id;
      payment.metadata = {
        receipt: razorpayOrder.receipt || order.orderNumber,
      };
      await payment.save();
      await Order.updateOne(
        { _id: order._id, status: "PENDING_PAYMENT" },
        {
          $set: {
            paymentSummary: {
              status: "CREATED",
              provider: "RAZORPAY",
              providerOrderId: payment.providerOrderId,
              providerPaymentId: null,
            },
          },
        },
      );
      return this.checkoutResponse(payment);
    } catch (error) {
      payment.status = "FAILED";
      payment.failureReason = "Unable to create Razorpay order";
      payment.activeOrderKey = undefined;
      await payment.save();
      throw error;
    }
  }
  checkoutResponse(payment) {
    return {
      paymentId: payment._id,
      razorpayOrderId: payment.providerOrderId,
      amount: payment.amount,
      currency: payment.currency,
      keyId: credentials.keyId,
      orderId: payment.order,
    };
  }
  paymentSignature(providerOrderId, providerPaymentId, signature) {
    const expected = crypto
      .createHmac("sha256", credentials.keySecret)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest("hex");
    return safeEqualHex(expected, signature);
  }
  webhookSignature(rawBody, signature) {
    const expected = crypto
      .createHmac("sha256", credentials.webhookSecret)
      .update(rawBody)
      .digest("hex");
    return safeEqualHex(expected, signature);
  }
  async verify(
    customerId,
    {
      razorpay_order_id: providerOrderId,
      razorpay_payment_id: providerPaymentId,
      razorpay_signature: signature,
    },
  ) {
    this.requireEnabled();
    const payment = await Payment.findOne({
      customer: customerId,
      providerOrderId,
    });
    if (!payment) throw AppError.notFound("Payment attempt not found");
    if (!this.paymentSignature(providerOrderId, providerPaymentId, signature))
      throw AppError.unauthorized("Invalid Razorpay payment signature");
    if (payment.status === "CAPTURED") {
      if (payment.providerPaymentId !== providerPaymentId)
        throw AppError.conflict(
          "Payment attempt is already linked to another payment",
        );
      return publicPayment(payment);
    }
    const providerPayment = await gateway.fetchPayment(providerPaymentId);
    if (
      providerPayment.order_id !== providerOrderId ||
      Number(providerPayment.amount) !== payment.amount ||
      providerPayment.currency !== payment.currency
    )
      throw AppError.unauthorized(
        "Razorpay payment details do not match this order",
      );
    if (providerPayment.status === "failed") {
      await this.markFailed(
        payment,
        providerPayment.error_description || "Payment failed",
        providerPayment.method,
        providerPaymentId,
      );
      throw AppError.conflict("Razorpay reports this payment failed");
    }
    if (providerPayment.status !== "captured") {
      if (providerPayment.status === "authorized") {
        payment.status = "AUTHORIZED";
        payment.providerPaymentId = providerPaymentId;
        payment.method = providerPayment.method || null;
        await payment.save();
      }
      throw AppError.conflict("Payment has not been captured yet");
    }
    await this.markCaptured(payment, {
      providerPaymentId,
      method: providerPayment.method,
    });
    return publicPayment(await Payment.findById(payment._id));
  }
  async markCaptured(
    payment,
    { providerPaymentId = null, method = null } = {},
  ) {
    if (payment.status === "CAPTURED") return payment;
    if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status))
      throw AppError.conflict(
        "Refunded payment attempt cannot be captured again",
      );
    if (
      !["CREATED", "AUTHORIZED", "FAILED", "CANCELLED"].includes(payment.status)
    )
      return payment;
    const order = await Order.findById(payment.order);
    if (!order) throw AppError.notFound("Order not found");
    let eligibleOrder = ["PENDING_PAYMENT", "CONFIRMED"].includes(order.status);
    if (order.status === "PENDING_PAYMENT") {
      const summary = {
        status: "CAPTURED",
        provider: "RAZORPAY",
        providerOrderId: payment.providerOrderId,
        providerPaymentId: providerPaymentId || payment.providerPaymentId,
      };
      try {
        await orderService.updateStatus(order._id, "CONFIRMED", null, {
          paymentSummary: summary,
          paymentStatus: "PAYMENT_CONFIRMED",
        });
      } catch (error) {
        const currentOrder = await Order.findById(order._id);
        if (currentOrder?.status !== "CONFIRMED") eligibleOrder = false;
      }
    }
    const capturedAt = new Date();
    const metadata = {
      ...(payment.metadata || {}),
      ...(eligibleOrder ? {} : { captureNeedsReconciliation: true }),
    };
    let captured;
    try {
      captured = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          status: { $in: ["CREATED", "AUTHORIZED", "FAILED", "CANCELLED"] },
        },
        {
          $set: {
            status: "CAPTURED",
            providerPaymentId: providerPaymentId || payment.providerPaymentId,
            method: method || payment.method,
            capturedAt,
            verifiedAt: capturedAt,
            capturedOrderKey: String(payment.order),
            metadata,
          },
          $unset: { activeOrderKey: 1 },
        },
        { new: true, runValidators: true },
      );
    } catch (error) {
      if (error.code === 11000) {
        const existingCapture = await Payment.findOne({
          capturedOrderKey: String(payment.order),
          status: "CAPTURED",
        });
        if (existingCapture)
          await Order.updateOne(
            { _id: order._id },
            {
              $set: {
                paymentSummary: {
                  status: "CAPTURED",
                  provider: "RAZORPAY",
                  providerOrderId: existingCapture.providerOrderId,
                  providerPaymentId: existingCapture.providerPaymentId,
                },
              },
            },
          );
        throw AppError.conflict(
          "Another payment attempt has already been captured for this order",
        );
      }
      throw error;
    }
    if (!captured) {
      const current = await Payment.findById(payment._id);
      if (
        current?.status === "CAPTURED" &&
        current.providerPaymentId ===
          (providerPaymentId || payment.providerPaymentId)
      )
        return current;
      throw AppError.conflict(
        "Payment attempt changed while capture was being processed",
      );
    }
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          paymentSummary: {
            status: "CAPTURED",
            provider: "RAZORPAY",
            providerOrderId: captured.providerOrderId,
            providerPaymentId: captured.providerPaymentId,
          },
        },
      },
    );
    await notificationService.createSafely({
      recipient: order.customer,
      type: "PAYMENT_CONFIRMED",
      title: "Payment confirmed",
      message: `Payment for order ${order.orderNumber} was confirmed.`,
      relatedEntityType: "ORDER",
      relatedEntityId: order._id,
      dedupeKey: `payment-captured:${order._id}`,
    });
    return captured;
  }
  async markFailed(payment, reason, method = null, providerPaymentId = null) {
    const failed = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        status: { $in: ["CREATED", "AUTHORIZED", "FAILED"] },
      },
      {
        $set: {
          status: "FAILED",
          failureReason: String(reason || "Payment failed").slice(0, 500),
          ...(method ? { method } : {}),
          ...(providerPaymentId ? { providerPaymentId } : {}),
        },
        $unset: { activeOrderKey: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!failed) return Payment.findById(payment._id);
    await Order.updateOne(
      { _id: failed.order, status: "PENDING_PAYMENT" },
      {
        $set: {
          paymentSummary: {
            status: "FAILED",
            provider: "RAZORPAY",
            providerOrderId: failed.providerOrderId,
            providerPaymentId: failed.providerPaymentId,
          },
        },
      },
    );
    const order = await Order.findById(failed.order).select(
      "customer orderNumber",
    );
    if (order)
      await notificationService.createSafely({
        recipient: order.customer,
        type: "PAYMENT_FAILED",
        title: "Payment failed",
        message: `Payment for order ${order.orderNumber} failed. You can retry from your orders.`,
        relatedEntityType: "ORDER",
        relatedEntityId: order._id,
        dedupeKey: `payment-failed:${failed._id}`,
      });
    return failed;
  }
  async cancelOpenAttempts(orderId, reason = "Order cancelled") {
    const attempts = await Payment.find({
      order: orderId,
      status: { $in: ["CREATED", "AUTHORIZED"] },
    }).select("_id");
    for (const attempt of attempts) {
      const payment = await Payment.findOneAndUpdate(
        { _id: attempt._id, status: { $in: ["CREATED", "AUTHORIZED"] } },
        {
          $set: { status: "CANCELLED", failureReason: reason.slice(0, 500) },
          $unset: { activeOrderKey: 1 },
        },
        { new: true },
      );
      if (payment)
        await Order.updateOne(
          { _id: orderId },
          {
            $set: {
              paymentSummary: {
                status: "CANCELLED",
                provider: "RAZORPAY",
                providerOrderId: payment.providerOrderId,
                providerPaymentId: payment.providerPaymentId,
              },
            },
          },
        );
    }
  }
  async cancelExpiredAttempts() {
    const attempts = await Payment.find({
      status: { $in: ["CREATED", "AUTHORIZED"] },
      activeOrderKey: { $type: "string" },
    });
    for (const payment of attempts) {
      const order = await Order.findById(payment.order);
      if (order?.status === "EXPIRED")
        await this.cancelOpenAttempts(
          order._id,
          "Order payment reservation expired",
        );
    }
  }
  async handleWebhook({ rawBody, signature, eventId, body }) {
    this.requireEnabled({ webhook: true });
    if (!rawBody || !this.webhookSignature(rawBody, signature))
      throw AppError.unauthorized("Invalid Razorpay webhook signature");
    if (!eventId) throw AppError.badRequest("Razorpay event ID is required");
    let receipt;
    const processingUntil = new Date(Date.now() + 5 * 60_000);
    try {
      receipt = await PaymentEvent.create({
        providerEventId: eventId,
        eventType: body.event,
        status: "PROCESSING",
        processingUntil,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      receipt = await PaymentEvent.findOne({ providerEventId: eventId });
      if (receipt?.status === "PROCESSED" || receipt?.status === "IGNORED")
        return { received: true, duplicate: true };
      if (
        receipt?.status === "PROCESSING" &&
        receipt.processingUntil > new Date()
      )
        throw AppError.conflict(
          "Razorpay event is already being processed; retry delivery",
        );
      receipt = await PaymentEvent.findOneAndUpdate(
        {
          providerEventId: eventId,
          $or: [
            { status: "FAILED" },
            { processingUntil: { $lte: new Date() } },
            { processingUntil: null },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            eventType: body.event,
            processingUntil,
          },
        },
        { new: true },
      );
      if (!receipt) return { received: true, duplicate: true };
    }
    try {
      const eventType = body.event;
      const paymentEntity = body.payload?.payment?.entity;
      const orderEntity = body.payload?.order?.entity;
      const providerOrderId = paymentEntity?.order_id || orderEntity?.id;
      const payment = providerOrderId
        ? await Payment.findOne({ providerOrderId })
        : null;
      if (
        !payment ||
        !["payment.captured", "payment.failed", "order.paid"].includes(
          eventType,
        )
      ) {
        receipt.status = "IGNORED";
        receipt.processedAt = new Date();
        receipt.processingUntil = null;
        await receipt.save();
        return { received: true, ignored: true };
      }
      if (
        Number(
          paymentEntity?.amount ??
            orderEntity?.amount_paid ??
            orderEntity?.amount,
        ) !== payment.amount ||
        (paymentEntity?.currency || orderEntity?.currency) !== payment.currency
      )
        throw AppError.unauthorized(
          "Webhook amount or currency does not match the payment",
        );
      receipt.payment = payment._id;
      if (eventType === "payment.failed")
        await this.markFailed(
          payment,
          paymentEntity?.error_description || "Payment failed",
          paymentEntity?.method,
          paymentEntity?.id,
        );
      else {
        const payId = paymentEntity?.id || null;
        await this.markCaptured(payment, {
          providerPaymentId: payId,
          method: paymentEntity?.method || null,
        });
      }
      receipt.status = "PROCESSED";
      receipt.processedAt = new Date();
      receipt.processingUntil = null;
      await receipt.save();
      return { received: true, duplicate: false };
    } catch (error) {
      await PaymentEvent.updateOne(
        { _id: receipt._id },
        { $set: { status: "FAILED", processingUntil: null } },
      );
      throw error;
    }
  }
  async get(paymentId, user) {
    const filter =
      user.role === "CUSTOMER"
        ? { _id: paymentId, customer: user._id }
        : { _id: paymentId };
    const payment = await Payment.findOne(filter);
    if (!payment) throw AppError.notFound("Payment not found");
    return publicPayment(payment);
  }
  async summaryForOrder(orderId) {
    const payment = await Payment.findOne({ order: orderId }).sort({
      createdAt: -1,
    });
    return payment
      ? {
          status: payment.status,
          provider: payment.provider,
          providerOrderId: payment.providerOrderId,
          providerPaymentId: payment.providerPaymentId,
        }
      : null;
  }
}

export const paymentService = new PaymentService();
export { toSubunits, publicPayment };
export default paymentService;
