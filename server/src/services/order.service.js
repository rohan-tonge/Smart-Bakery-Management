import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import PaymentProof from "../models/paymentProof.model.js";
import OrderCounter from "../models/orderCounter.model.js";
import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import Ingredient from "../models/ingredient.model.js";
import FinishedProductStock from "../models/finishedProductStock.model.js";
import { orderFeasibilityService } from "./order-feasibility.service.js";
import deliverySlotService from "./deliverySlot.service.js";
import {
  runAtomicInventoryOperation,
  inventoryService,
} from "./inventory.service.js";
import config from "../config/config.js";
import AppError from "../utils/appError.js";
import { notificationService } from "./notification.service.js";
import capacityService from "./capacity.service.js";
import eventStream from "../utils/eventStream.js";
import ProductionBatch from "../models/productionBatch.model.js";
import {
  CUSTOMER_ORDER_STATUSES as S,
  ORDER_TYPES,
} from "../utils/constants.js";
import { roundQuantity } from "../utils/measurement.utils.js";
import { isDateNextDayOrLater } from "../utils/date.utils.js";

const money = (n) => Number(n.toFixed(2));
const transitions = {
  [S.PENDING_PAYMENT]: [S.CONFIRMED, S.CANCELLED, S.EXPIRED],
  [S.CONFIRMED]: [S.CANCELLED, S.IN_PRODUCTION, S.READY],
  [S.IN_PRODUCTION]: [S.READY],
  [S.READY]: [S.OUT_FOR_DELIVERY, S.COMPLETED],
  [S.OUT_FOR_DELIVERY]: [S.DELIVERED],
  [S.DELIVERED]: [S.COMPLETED],
};

export function calculateStockPosition(order, stockMap) {
  const items = order.items || [];
  const finishedCommitments = order.finishedCommitments || [];
  let totalRequested = 0;
  let totalCommitted = 0;
  let totalAvailableForOrder = 0;
  let allItemsAvailable = items.length > 0;
  const itemsDetail = [];

  for (const item of items) {
    const prodId = String(item.productId?._id || item.productId || item.product);
    const varId = String(item.variantId || item.variant);
    const qty = Number(item.quantity) || 0;
    totalRequested += qty;

    const fc = finishedCommitments.find(
      (c) => String(c.product) === prodId && String(c.variant) === varId
    );
    const committed = Number(fc?.quantity) || 0;
    totalCommitted += committed;

    const stockKey = `${prodId}:${varId}`;
    const stock = stockMap.get(stockKey);
    const onHand = Number(stock?.onHandQuantity) || 0;
    const reserved = Number(stock?.reservedQuantity) || 0;
    const free = Math.max(0, onHand - reserved);

    const itemAvailable = committed + free;
    const needed = Math.max(0, qty - committed);
    const fulfillableFromStock = Math.min(qty, itemAvailable);
    totalAvailableForOrder += fulfillableFromStock;

    if (itemAvailable < qty) {
      allItemsAvailable = false;
    }

    itemsDetail.push({
      productId: prodId,
      variantId: varId,
      productName: item.productName || item.product?.name,
      variantName: item.variantName,
      requestedQuantity: qty,
      alreadyCommitted: committed,
      freeStock: free,
      totalAvailable: itemAvailable,
      neededQuantity: needed,
      isFullyStocked: itemAvailable >= qty,
    });
  }

  const isAlreadyFulfilled =
    order.fulfillmentStatus === "FULFILLED_FROM_STOCK" ||
    (order.status === S.READY && totalCommitted >= totalRequested && totalRequested > 0);

  const isIneligible =
    [S.CANCELLED, S.DELIVERED, S.COMPLETED].includes(order.status) ||
    isAlreadyFulfilled;

  let status = "PRODUCTION_REQUIRED";
  let badge = "Production Required";
  let message = "";
  let canFulfillFromStock = false;

  if (isAlreadyFulfilled) {
    status = "FULFILLED_FROM_STOCK";
    badge = "Fulfilled from Stock";
    message = "All required products are fulfilled from finished stock.";
  } else if (order.status === S.CANCELLED) {
    status = "CANCELLED";
    badge = "Cancelled";
    message = "Order has been cancelled.";
  } else if (allItemsAvailable && totalRequested > 0) {
    status = "READY_FROM_STOCK";
    badge = "Ready from Stock";
    message = "All required products are available in finished stock.";
    canFulfillFromStock = !isIneligible;
  } else if (totalAvailableForOrder > 0) {
    status = "PARTIAL_STOCK";
    badge = "Partial Stock Available";
    const remaining = totalRequested - totalAvailableForOrder;
    message = `${totalAvailableForOrder} of ${totalRequested} items available in finished stock. ${remaining} require kitchen production.`;
  } else {
    status = "PRODUCTION_REQUIRED";
    badge = "Production Required";
    message = `Finished goods stock unavailable. Kitchen production required for ${totalRequested} units.`;
  }

  return {
    status,
    badge,
    message,
    canFulfillFromStock,
    totalRequested,
    totalCommitted,
    totalAvailable: totalAvailableForOrder,
    remainingToProduce: Math.max(0, totalRequested - totalAvailableForOrder),
    itemsDetail,
  };
}

class OrderService {
  async nextNumber() {
    const year = new Date().getFullYear();
    const counter = await OrderCounter.findOneAndUpdate(
      { _id: `ORD-${year}` },
      { $inc: { sequence: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return `ORD-${year}-${String(counter.sequence).padStart(6, "0")}`;
  }
  async checkout(customer, body, idempotencyKey) {
    const rawPaymentMethod = String(body.paymentMethod || "MANUAL_UPI").toUpperCase();
    const paymentMethod = (rawPaymentMethod === "COD" || rawPaymentMethod === "PAY_ON_DELIVERY") ? "COD" : rawPaymentMethod;
    if (!["MANUAL_UPI", "COD", "RAZORPAY"].includes(paymentMethod))
      throw AppError.badRequest("Unsupported payment method. Supported payment methods: MANUAL_UPI, COD (Pay on Delivery)");
    await this.expirePending();

    const isGuest = !customer;
    let cart = null;
    if (customer) {
      cart = await Cart.findOne({ customer });
    } else if (body.guestId) {
      cart = await Cart.findOne({ guestId: body.guestId });
    }

    const rawCartItems = cart?.items?.length
      ? cart.items
      : body.items?.map((x) => ({
          product: x.productId,
          variant: x.variantId,
          quantity: x.quantity,
          specialInstructions: x.specialInstructions || "",
          packInstructions: x.packInstructions || "",
        })) || [];

    if (!rawCartItems.length) throw AppError.badRequest("Cart is empty");

    const fingerprint = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          cart: rawCartItems.map((x) => [
            String(x.product),
            String(x.variant),
            x.quantity,
          ]),
          body,
        }),
      )
      .digest("hex");

    const orderOwner = customer ? { customer } : { guestId: body.guestId };
    if (idempotencyKey && (customer || body.guestId)) {
      const prior = await Order.findOne({ ...orderOwner, idempotencyKey });
      if (prior) {
        if (prior.requestFingerprint !== fingerprint)
          throw AppError.conflict(
            "Idempotency key was already used with a different request",
          );
        return prior;
      }
    }

    const feasibility = await orderFeasibilityService.check(
      rawCartItems.map((x) => ({
        productId: x.product,
        variantId: x.variant,
        quantity: x.quantity,
      })),
      { detailed: true },
    );
    if (!feasibility.feasible) {
      const invalidRecipeItems = feasibility.items?.filter(
        (x) => x.valid === false && x.message,
      );
      if (invalidRecipeItems?.length) {
        throw AppError.conflict(
          invalidRecipeItems.map((x) => x.message).join(" "),
          feasibility.shortages,
        );
      }
      throw AppError.conflict(
        feasibility.shortages?.length
          ? "Order cannot be fulfilled with current ingredient availability"
          : feasibility.checks?.capacityReady === false
            ? feasibility.checks?.capacityReason || "Order cannot be accepted because production capacity is unavailable"
            : "Order contains an unavailable product or variant",
        feasibility.shortages,
      );
    }

    const items = [];
    let subtotal = 0;
    for (const line of rawCartItems) {
      const product = await Product.findById(line.product);
      const variant = product?.variants.id(line.variant);
      if (
        !product?.isActive ||
        !product.isAvailable ||
        !variant?.isActive ||
        !variant.isAvailable
      )
        throw AppError.conflict("Cart contains an unavailable product");
      const lineTotal = money(variant.price * line.quantity);
      subtotal += lineTotal;
      items.push({
        productId: product._id,
        variantId: variant._id,
        productName: product.name,
        variantName: variant.name,
        quantity: line.quantity,
        unitPrice: variant.price,
        lineTotal,
        specialInstructions: line.specialInstructions,
        packInstructions: line.packInstructions || "",
      });
    }

    if (!body.deliveryDate || !isDateNextDayOrLater(body.deliveryDate)) {
      throw AppError.badRequest(
        "Orders must be scheduled at least one day in advance. Select tomorrow or a later date."
      );
    }

    if (!body.contactName || !body.contactName.trim()) {
      throw AppError.badRequest("Customer name is required");
    }

    const cleanedPhone = (body.contactPhone || "").replace(/\D/g, "");
    if (cleanedPhone.length < 10) {
      throw AppError.badRequest("Please enter a valid phone number (at least 10 digits)");
    }

    if (
      body.orderType === ORDER_TYPES.DELIVERY &&
      (!body.deliveryAddress ||
        !body.deliveryAddress.addressLine1?.trim() ||
        !body.deliveryAddress.city?.trim() ||
        !body.deliveryAddress.postalCode?.trim())
    ) {
      throw AppError.badRequest(
        "Complete delivery address (street address, city, pincode) is required for delivery orders"
      );
    }
    if (body.orderType === ORDER_TYPES.PICKUP && body.deliveryAddress) {
      throw AppError.badRequest(
        "Pickup orders cannot include a delivery address"
      );
    }
    const ingredientCommitments = feasibility.ingredientRequirements.map(
      (line) => ({
        ingredient: line.ingredientId,
        quantity: line.required,
        unit: line.unit,
      }),
    );
    const rollbackOps = { ingredients: [], finished: [], capacity: null, deliverySlot: null, orderId: null };
    const order = await runAtomicInventoryOperation(
      async (session) => {
        let selectedDeliveryDate = body.deliveryDate || null;
        let selectedDeliveryTimeSlot = body.deliveryTimeSlot || null;
        let slotReservation = null;

        if (selectedDeliveryDate && selectedDeliveryTimeSlot) {
          slotReservation = await deliverySlotService.validateAndReserveSlot({
            date: selectedDeliveryDate,
            timeSlot: selectedDeliveryTimeSlot,
            orderType: body.orderType,
            items: rawCartItems.map((x) => ({ productId: x.product, variantId: x.variant, quantity: x.quantity })),
            feasibility,
          });
          selectedDeliveryDate = slotReservation.deliveryDate;
          selectedDeliveryTimeSlot = slotReservation.deliveryTimeSlot;
          rollbackOps.deliverySlot = {
            date: selectedDeliveryDate,
            timeSlot: selectedDeliveryTimeSlot,
            orderType: body.orderType,
            token: slotReservation.token,
          };
        } else if (body.orderType === ORDER_TYPES.DELIVERY) {
          const slotAvailability = await deliverySlotService.getAvailableSlots({
            items: rawCartItems.map((x) => ({ productId: x.product, variantId: x.variant, quantity: x.quantity })),
            orderType: body.orderType,
            feasibility,
          });
          if (slotAvailability.firstAvailableSlot) {
            slotReservation = await deliverySlotService.validateAndReserveSlot({
              date: slotAvailability.firstAvailableSlot.date,
              timeSlot: slotAvailability.firstAvailableSlot.timeSlot,
              orderType: body.orderType,
              items: rawCartItems.map((x) => ({ productId: x.product, variantId: x.variant, quantity: x.quantity })),
              feasibility,
            });
            selectedDeliveryDate = slotReservation.deliveryDate;
            selectedDeliveryTimeSlot = slotReservation.deliveryTimeSlot;
            rollbackOps.deliverySlot = {
              date: selectedDeliveryDate,
              timeSlot: selectedDeliveryTimeSlot,
              orderType: body.orderType,
              token: slotReservation.token,
            };
          }
        }

        for (const line of ingredientCommitments) {
          const { currentStock } = await inventoryService.getCurrentStock(
            line.ingredient,
            session,
          );
          const ingredient = await Ingredient.findById(line.ingredient).session(
            session,
          );
          const availableForReservation = roundQuantity(
            currentStock - ingredient.minimumStock,
          );
          const requiredQuantity = roundQuantity(line.quantity);
          const updated = await Ingredient.findOneAndUpdate(
            {
              _id: line.ingredient,
              isActive: true,
              $expr: {
                $lte: [
                  {
                    $add: [
                      { $ifNull: ["$reservedStock", 0] },
                      { $ifNull: ["$productionReservedStock", 0] },
                      requiredQuantity,
                    ],
                  },
                  availableForReservation,
                ],
              },
            },
            { $inc: { reservedStock: requiredQuantity } },
            { new: true, ...(session ? { session } : {}) },
          );
          if (!updated)
            throw AppError.conflict(
              `Ingredient reservation changed for ${ingredient.name}; retry checkout`,
            );
          rollbackOps.ingredients.push({ ...line, quantity: requiredQuantity });
        }
        const finishedCommitments = [];
        for (const line of feasibility.items) {
          const quantity = line.finishedStock || 0;
          if (!quantity) continue;
          const stock = await FinishedProductStock.findOneAndUpdate(
            {
              product: line.productId,
              variant: line.variantId,
              $expr: {
                $lte: [
                  { $add: ["$reservedQuantity", quantity] },
                  "$onHandQuantity",
                ],
              },
            },
            { $inc: { reservedQuantity: quantity } },
            { new: true, ...(session ? { session } : {}) },
          );
          if (!stock)
            throw AppError.conflict(
              "Finished stock changed during checkout; retry",
            );
          rollbackOps.finished.push({ stock: stock._id, quantity });
          finishedCommitments.push({
            stock: stock._id,
            product: line.productId,
            variant: line.variantId,
            quantity,
          });
        }
        if (feasibility.production.required) {
          rollbackOps.capacity = await capacityService.reserve({
            dateKey: feasibility.capacity.reservationDate,
            minutes: feasibility.capacity.reservationMinutes,
            session,
          });
        }

        const isCod = paymentMethod === "COD";
        const initialStatus = isCod ? S.CONFIRMED : S.PENDING_PAYMENT;
        const initialPaymentStatus = "PAYMENT_PENDING";
        const reservationExpiresAt = isCod ? null : new Date(Date.now() + config.orders.reservationMinutes * 60_000);

        const year = new Date().getFullYear();
        const counter = await OrderCounter.findOneAndUpdate(
          { _id: `ORD-${year}` },
          { $inc: { sequence: 1 } },
          { upsert: true, new: true, ...(session ? { session } : {}) },
        );
        const number = `ORD-${year}-${String(counter.sequence).padStart(6, "0")}`;
        const guestTrackingToken = isGuest
          ? crypto.randomBytes(16).toString("hex")
          : null;
        const contactName =
          body.contactName?.trim() || (isGuest ? "Guest Customer" : "Customer");

        const created = await Order.create(
          [
            {
              orderNumber: number,
              customer: customer || null,
              isGuest,
              guestId: isGuest ? body.guestId : undefined,
              guestTrackingToken,
              items,
              subtotal: money(subtotal),
              discount: 0,
              tax: 0,
              deliveryFee: 0,
              total: money(subtotal),
              orderType: body.orderType,
              deliveryDate: selectedDeliveryDate,
              deliveryTimeSlot: selectedDeliveryTimeSlot,
              deliverySlotReservation: slotReservation
                ? {
                    token: slotReservation.token,
                    date: selectedDeliveryDate,
                    timeSlot: selectedDeliveryTimeSlot,
                    orderType: body.orderType,
                    released: false,
                  }
                : null,
              paymentMethod,
              paymentStatus: initialPaymentStatus,
              deliveryAddress: body.deliveryAddress || null,
              contactName,
              contactPhone: body.contactPhone.trim(),
              contactEmail: body.contactEmail || "",
              specialInstructions: body.specialInstructions || "",
              packInstructions: body.packInstructions || "",
              status: initialStatus,
              feasibilitySnapshot: feasibility,
              ingredientCommitments,
              finishedCommitments,
              ...(rollbackOps.capacity
                ? { capacityCommitment: { ...rollbackOps.capacity, released: false } }
                : {}),
              estimatedReadyAt: feasibility.estimatedReadyAt,
              reservationExpiresAt,
              idempotencyKey,
              requestFingerprint: fingerprint,
            },
          ],
          session ? { session } : {},
        );
        rollbackOps.orderId = created[0]._id;
        if (slotReservation?.token) {
          await deliverySlotService.commitSlotReservation({
            date: selectedDeliveryDate,
            timeSlot: selectedDeliveryTimeSlot,
            orderType: body.orderType,
            token: slotReservation.token,
            orderId: created[0]._id,
            orderNumber: created[0].orderNumber,
          });
        }
        if (cart?._id) {
          await Cart.updateOne(
            { _id: cart._id },
            { $set: { items: [] }, $inc: { version: 1 } },
            session ? { session } : {},
          );
        }

        if (isCod) {
          await this.notifyManagersForOrder(
            "ORDER_STATUS_CHANGED",
            "Pay-on-Delivery Order Confirmed",
            `Order ${created[0].orderNumber} confirmed (Pay on Delivery). Ready for kitchen scheduling; collect payment on delivery/pickup.`,
            created[0],
          );
        }

        return created[0];
      },
      async () => {
        if (rollbackOps.orderId)
          await Order.deleteOne({ _id: rollbackOps.orderId });
        if (rollbackOps.deliverySlot)
          await deliverySlotService.releaseSlotReservation(rollbackOps.deliverySlot);
        if (rollbackOps.capacity)
          await capacityService.release({
            dateKey: rollbackOps.capacity.date,
            minutes: rollbackOps.capacity.minutes,
          });
        for (const item of rollbackOps.ingredients)
          await Ingredient.updateOne(
            { _id: item.ingredient, reservedStock: { $gte: item.quantity } },
            { $inc: { reservedStock: -item.quantity } },
          );
        for (const item of rollbackOps.finished)
          await FinishedProductStock.updateOne(
            { _id: item.stock, reservedQuantity: { $gte: item.quantity } },
            { $inc: { reservedQuantity: -item.quantity } },
          );
      },
    );

    if (order.status === S.CONFIRMED) {
      await this.notifyManagersForOrder(
        "ORDER_STATUS_CHANGED",
        "New Confirmed Order",
        `New order ${order.orderNumber} confirmed. Action required: Assign production staff.`,
        order,
      );
    } else {
      await this.notifyManagersForOrder(
        "ORDER_STATUS_CHANGED",
        "New Customer Order",
        `New order ${order.orderNumber} placed. Awaiting customer payment.`,
        order,
      );
    }

    return order;
  }
  async expirePending() {
    const query = Order.find({
      status: S.PENDING_PAYMENT,
      reservationExpiresAt: { $lte: new Date() },
    });
    for (const order of await query) {
      await this.transitionAtomically(order, S.EXPIRED);
    }
  }
  async transition(
    order,
    status,
    {
      actor = null,
      reason = "",
      session = null,
      rollbackState,
      additionalOrderSet = {},
    } = {},
  ) {
    if (
      !transitions[order.status]?.includes(status) &&
      !(status === S.CANCELLED && order.status === S.PENDING_PAYMENT)
    )
      throw AppError.conflict(
        `Cannot transition order from ${order.status} to ${status}`,
      );
    const previousStatus = order.status;
    if (status === S.CONFIRMED && previousStatus === S.PENDING_PAYMENT) {
      const verifiedManual = order.paymentMethod === "MANUAL_UPI" &&
        (order.paymentStatus === "PAYMENT_CONFIRMED" || additionalOrderSet.paymentStatus === "PAYMENT_CONFIRMED");
      const capturedProvider = order.paymentMethod === "RAZORPAY" &&
        (order.paymentSummary?.status === "CAPTURED" || additionalOrderSet.paymentSummary?.status === "CAPTURED");
      if (!verifiedManual && !capturedProvider)
        throw AppError.conflict("Payment must be verified before confirming this order");
    }
    rollbackState.previousStatus = previousStatus;
    rollbackState.nextStatus = status;
    rollbackState.previousCancellation =
      order.cancellation?.toObject?.() || order.cancellation;
    const nextCancellation = [S.CANCELLED, S.EXPIRED].includes(status)
      ? { reason, cancelledBy: actor, cancelledAt: new Date() }
      : undefined;
    const claimFilter = { _id: order._id, status: previousStatus };
    if ([S.CANCELLED, S.EXPIRED].includes(status))
      claimFilter["paymentSummary.status"] = { $ne: "CAPTURED" };
    const claimed = await Order.updateOne(
      claimFilter,
      {
        $set: {
          status,
          ...additionalOrderSet,
          ...(nextCancellation ? { cancellation: nextCancellation } : {}),
        },
      },
      session ? { session } : {},
    );
    if (!claimed.modifiedCount)
      throw AppError.conflict(
        "Order status changed during this operation; reload and retry",
      );
    rollbackState.claimed = true;
    if ([S.CANCELLED, S.EXPIRED, S.COMPLETED].includes(status)) {
      for (const line of order.ingredientCommitments) {
        const result = await Ingredient.updateOne(
          { _id: line.ingredient, reservedStock: { $gte: line.quantity } },
          { $inc: { reservedStock: -line.quantity } },
          session ? { session } : {},
        );
        if (!result.modifiedCount)
          throw AppError.conflict(
            "Ingredient reservation is inconsistent; manual reconciliation is required",
          );
        rollbackState.ingredients.push(line);
      }
      if (status === S.COMPLETED) {
        for (const line of order.finishedCommitments) {
          const result = await FinishedProductStock.updateOne(
            {
              _id: line.stock,
              reservedQuantity: { $gte: line.quantity },
              onHandQuantity: { $gte: line.quantity },
            },
            {
              $inc: {
                reservedQuantity: -line.quantity,
                onHandQuantity: -line.quantity,
              },
              $push: {
                history: {
                  action: "ORDER_FULFILLED",
                  quantity: line.quantity,
                  previousOnHand: 0,
                  newOnHand: 0,
                  previousReserved: line.quantity,
                  newReserved: 0,
                  referenceType: "ORDER",
                  referenceId: order._id,
                  note: `Order ${order.orderNumber} fulfilled and dispatched from finished stock.`,
                  performedBy: actor?._id || null,
                  timestamp: new Date(),
                },
              },
            },
            session ? { session } : {},
          );
          if (!result.modifiedCount)
            throw AppError.conflict(
              "Finished stock reservation is inconsistent; manual reconciliation is required",
            );
          rollbackState.consumedFinished.push(line);
        }
      } else {
        for (const line of order.finishedCommitments) {
          const result = await FinishedProductStock.updateOne(
            { _id: line.stock, reservedQuantity: { $gte: line.quantity } },
            {
              $inc: { reservedQuantity: -line.quantity },
              $push: {
                history: {
                  action: "ORDER_RELEASED",
                  quantity: line.quantity,
                  previousOnHand: 0,
                  newOnHand: 0,
                  previousReserved: line.quantity,
                  newReserved: 0,
                  referenceType: "ORDER",
                  referenceId: order._id,
                  note: `Order ${order.orderNumber} ${status === S.CANCELLED ? 'cancelled' : 'updated'}: released finished stock reservation.`,
                  performedBy: actor?._id || null,
                  timestamp: new Date(),
                },
              },
            },
            session ? { session } : {},
          );
          if (!result.modifiedCount)
            throw AppError.conflict(
              "Finished stock reservation is inconsistent; manual reconciliation is required",
            );
          rollbackState.finished.push(line);
        }
      }
      if (order.capacityCommitment?.minutes && !order.capacityCommitment.released) {
        await capacityService.release({
          dateKey: order.capacityCommitment.date,
          minutes: order.capacityCommitment.minutes,
          session,
        });
        rollbackState.capacity = order.capacityCommitment;
        await Order.updateOne(
          { _id: order._id, "capacityCommitment.released": { $ne: true } },
          { $set: { "capacityCommitment.released": true } },
          session ? { session } : {},
        );
      }
      if (
        [S.CANCELLED, S.EXPIRED].includes(status) &&
        order.deliveryDate &&
        order.deliveryTimeSlot &&
        !order.deliverySlotReservation?.released
      ) {
        await deliverySlotService.releaseSlotReservation({
          date: order.deliveryDate,
          timeSlot: order.deliveryTimeSlot,
          orderType: order.orderType,
          token: order.deliverySlotReservation?.token,
          orderId: order._id,
        });
        rollbackState.deliverySlot = {
          date: order.deliveryDate,
          timeSlot: order.deliveryTimeSlot,
          orderType: order.orderType,
          token: order.deliverySlotReservation?.token,
        };
        await Order.updateOne(
          { _id: order._id, "deliverySlotReservation.released": { $ne: true } },
          { $set: { "deliverySlotReservation.released": true } },
          session ? { session } : {},
        );
      }
    }
    return Order.findById(order._id).session(session);
  }
  async rollbackTransition(order, state) {
    if (!state.claimed) return;
    for (const line of state.ingredients)
      await Ingredient.updateOne(
        { _id: line.ingredient },
        { $inc: { reservedStock: line.quantity } },
      );
    for (const line of state.finished)
      await FinishedProductStock.updateOne(
        { _id: line.stock },
        { $inc: { reservedQuantity: line.quantity } },
      );
    for (const line of state.consumedFinished)
      await FinishedProductStock.updateOne(
        { _id: line.stock },
        {
          $inc: {
            reservedQuantity: line.quantity,
            onHandQuantity: line.quantity,
          },
        },
      );
    if (state.capacity)
      await capacityService.reserve({
        dateKey: state.capacity.date,
        minutes: state.capacity.minutes,
      });
    if (state.deliverySlot)
      await deliverySlotService.reacquireSlotReservation({
        date: state.deliverySlot.date,
        timeSlot: state.deliverySlot.timeSlot,
        orderType: state.deliverySlot.orderType,
        token: state.deliverySlot.token,
        orderId: order._id,
      });
    await Order.updateOne(
      { _id: order._id, status: state.nextStatus },
      {
        $set: {
          status: state.previousStatus,
          cancellation: state.previousCancellation,
          ...(state.capacity ? { "capacityCommitment.released": false } : {}),
          ...(state.deliverySlot ? { "deliverySlotReservation.released": false } : {}),
        },
      },
    );
  }
  async transitionAtomically(order, status, options = {}) {
    const state = {
      claimed: false,
      ingredients: [],
      finished: [],
      consumedFinished: [],
      capacity: null,
      deliverySlot: null,
    };
    const updated = await runAtomicInventoryOperation(
      (session) =>
        this.transition(order, status, {
          ...options,
          session,
          rollbackState: state,
        }),
      () => this.rollbackTransition(order, state),
    );
    const type =
      status === S.CANCELLED
        ? "ORDER_CANCELLED"
        : options.paymentSummary?.status === "CAPTURED"
          ? "PAYMENT_CONFIRMED"
          : "ORDER_STATUS_CHANGED";
    if (updated.customer) {
      await notificationService.createSafely({
        recipient: updated.customer,
        type,
        title: type === "ORDER_CANCELLED" ? "Order cancelled" : "Order updated",
        message: `Order ${updated.orderNumber} is now ${status.toLowerCase().replaceAll("_", " ")}.`,
        relatedEntityType: "ORDER",
        relatedEntityId: updated._id,
        dedupeKey:
          options.paymentSummary?.status === "CAPTURED"
            ? `payment-captured:${updated._id}`
            : `order:${updated._id}:${status}`,
      });
    }
    return updated;
  }
  async cancel(id, customer, actor, reason) {
    const filter = customer ? { _id: id, customer } : { _id: id };
    const order = await Order.findOne(filter);
    if (!order) throw AppError.notFound("Order not found");
    if (![S.PENDING_PAYMENT, S.CONFIRMED].includes(order.status))
      throw AppError.conflict(
        `Cannot transition order from ${order.status} to ${S.CANCELLED}`,
      );
    return this.transitionAtomically(order, S.CANCELLED, { actor, reason });
  }
  async cancelFromProductionHold(id, actor, reason) {
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");
    if (order.status === S.CANCELLED) {
      throw AppError.conflict("Order is already cancelled");
    }
    if (![S.IN_PRODUCTION, S.CONFIRMED].includes(order.status)) {
      throw AppError.conflict(`Cannot cancel an order in status ${order.status} from production hold`);
    }

    // Release capacity commitment if not already released
    if (order.capacityCommitment?.minutes && !order.capacityCommitment.released) {
      try {
        await capacityService.release({
          dateKey: order.capacityCommitment.date,
          minutes: order.capacityCommitment.minutes,
        });
        order.capacityCommitment.released = true;
      } catch (err) {
        // ignore release failure
      }
    }

    // Release delivery slot if not already released
    if (order.deliveryDate && order.deliveryTimeSlot && !order.deliverySlotReservation?.released) {
      try {
        await deliverySlotService.releaseSlotReservation({
          date: order.deliveryDate,
          timeSlot: order.deliveryTimeSlot,
          orderType: order.orderType,
          token: order.deliverySlotReservation?.token,
          orderId: order._id,
        });
        if (order.deliverySlotReservation) {
          order.deliverySlotReservation.released = true;
        }
      } catch (err) {
        // ignore slot release failure
      }
    }

    // Release remaining unconsumed reserved raw stock if any
    // Do NOT reverse consumed physical stock or touch on-hand currentStock
    for (const line of order.ingredientCommitments || []) {
      try {
        await Ingredient.updateOne(
          { _id: line.ingredient, reservedStock: { $gte: line.quantity } },
          { $inc: { reservedStock: -line.quantity } }
        );
      } catch (err) {
        // ignore
      }
    }

    order.status = S.CANCELLED;
    order.cancellation = {
      reason: reason || "Cancelled from emergency production hold",
      cancelledBy: actor?._id || null,
      cancelledAt: new Date(),
    };
    if (order.holdState) {
      order.holdState.isOnHold = false;
      order.holdState.holdResolvedAt = new Date();
      order.holdState.holdResolvedBy = actor?._id || null;
      order.holdState.holdResolution = "CANCEL_ORDER";
      order.holdState.resolutionNote = reason || "";
    }

    await order.save();

    if (order.customer) {
      await notificationService.createSafely({
        recipient: order.customer,
        type: "ORDER_CANCELLED",
        title: "Order cancelled",
        message: `Order ${order.orderNumber} has been cancelled while in production. Reason: ${reason || "Customer/Owner requested cancellation"}`,
        relatedEntityType: "ORDER",
        relatedEntityId: order._id,
        dedupeKey: `order-cancelled-hold:${order._id}:${Date.now()}`,
      });
    }

    eventStream.broadcast("ORDER_STATUS_CHANGED", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: S.CANCELLED,
      cancellation: order.cancellation,
    });

    return order;
  }
  async placeOrderOnHold(id, input, user) {
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");
    if (order.holdState?.isOnHold) {
      throw AppError.conflict(`Order ${order.orderNumber} is already on hold`);
    }
    if (![S.IN_PRODUCTION, S.CONFIRMED].includes(order.status)) {
      throw AppError.conflict(`Only confirmed or in-production orders can be placed on hold (current status: ${order.status})`);
    }

    const batch = await ProductionBatch.findOne({
      relatedOrders: order._id,
      status: { $in: ["PLANNED", "ACCEPTED", "VERIFIED", "IN_PRODUCTION", "QUALITY_CHECK", "PACKAGING"] },
    });

    if (batch) {
      const { default: productionService } = await import("./production.service.js");
      const updatedBatch = await productionService.placeHold(batch._id, input, user);
      const updatedOrder = await Order.findById(order._id);
      return { order: updatedOrder, batch: updatedBatch };
    }

    order.holdState = {
      isOnHold: true,
      holdReason: input.reason,
      holdInstruction: input.instruction,
      ownerNote: input.ownerNote || "",
      holdRequestedAt: new Date(),
      holdRequestedBy: user._id,
      instructionVersion: 1,
      bakerAcknowledged: false,
      bakerAcknowledgedAt: null,
      bakerResponse: null,
      holdResolvedAt: null,
      holdResolvedBy: null,
      holdResolution: "",
      resolutionNote: "",
      relatedBatch: null,
    };
    await order.save();

    eventStream.broadcast("PRODUCTION_HOLD", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      holdState: order.holdState,
    });

    return { order, batch: null };
  }
  async updateStatus(id, status, actor, { paymentSummary, paymentStatus } = {}) {
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");
    if (!transitions[order.status]?.includes(status))
      throw AppError.conflict(
        `Cannot transition order from ${order.status} to ${status}`,
      );

    // If accepting/confirming an order from PENDING_PAYMENT, revalidate inventory availability
    if (status === S.CONFIRMED && order.status === S.PENDING_PAYMENT) {
      const inventoryCheck = await orderFeasibilityService.checkOrder(order._id, { detailed: true });
      if (!inventoryCheck.feasible) {
        const details = (inventoryCheck.shortages || [])
          .map(
            (s) =>
              `${s.ingredientName}: required ${s.required} ${s.unit}, available ${s.available} ${s.unit}, shortage ${s.shortage} ${s.unit}`,
          )
          .join("; ");
        throw AppError.conflict(
          `Order cannot be accepted: insufficient inventory for required ingredients${details ? ` (${details})` : ""}`,
          inventoryCheck.shortages,
        );
      }
    }

    return this.transitionAtomically(order, status, {
      actor,
      additionalOrderSet: {
        ...(paymentSummary ? { paymentSummary } : {}),
        ...(paymentStatus ? { paymentStatus } : {}),
      },
    });
  }
  async reorder(id, customer) {
    const order = await Order.findOne({ _id: id, customer });
    if (!order) throw AppError.notFound("Order not found");
    const cart = await Cart.findOneAndUpdate(
      { customer },
      { $setOnInsert: { customer } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const unavailable = [];
    for (const line of order.items) {
      const product = await Product.findById(line.productId);
      const variant = product?.variants.id(line.variantId);
      if (
        !product?.isActive ||
        !product.isAvailable ||
        !variant?.isActive ||
        !variant.isAvailable
      ) {
        unavailable.push({
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          variantName: line.variantName,
        });
        continue;
      }
      const existing = cart.items.find(
        (x) =>
          String(x.product) === String(line.productId) &&
          String(x.variant) === String(line.variantId),
      );
      if (existing)
        existing.quantity = Math.min(100, existing.quantity + line.quantity);
      else
        cart.items.push({
          product: line.productId,
          variant: line.variantId,
          quantity: Math.min(100, line.quantity),
          specialInstructions: line.specialInstructions,
        });
    }
    cart.version += 1;
    await cart.save();
    return { cart, unavailable };
  }
  async list({
    customer,
    page = 1,
    limit = 20,
    status,
    from,
    to,
    orderNumber,
    search,
  }) {
    const filter = {};
    if (customer) filter.customer = customer;
    if (status) filter.status = status;
    if (orderNumber) filter.orderNumber = orderNumber;
    if (from || to)
      filter.createdAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    if (search && typeof search === "string" && search.trim()) {
      const term = search.trim();
      const searchRegex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const matchingUsers = await User.find({ name: searchRegex }).select("_id").lean();
      const userIds = matchingUsers.map((u) => u._id);
      filter.$or = [
        { contactName: searchRegex },
        { contactPhone: searchRegex },
        { orderNumber: searchRegex },
        ...(userIds.length > 0 ? [{ customer: { $in: userIds } }] : []),
      ];
    }
    const baseMatch = [];
    if (filter.customer) {
      const custId = mongoose.Types.ObjectId.isValid(filter.customer)
        ? new mongoose.Types.ObjectId(String(filter.customer))
        : filter.customer;
      baseMatch.push({ $match: { customer: custId } });
    }

    const [ordersDocs, total, stocks, facetRes] = await Promise.all([
      Order.find(filter)
        .populate("customer", "name email phone")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(filter),
      FinishedProductStock.find({}).lean(),
      Order.aggregate([
        ...baseMatch,
        {
          $facet: {
            byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
            pendingVerification: [
              { $match: { paymentStatus: "PENDING_VERIFICATION" } },
              { $count: "count" },
            ],
            total: [{ $count: "count" }],
          },
        },
      ]),
    ]);

    const facet = facetRes?.[0] || {};
    const totalAllOrders = facet.total?.[0]?.count || 0;
    const pendingVerificationCount = facet.pendingVerification?.[0]?.count || 0;
    const byStatus = {};
    for (const item of facet.byStatus || []) {
      byStatus[item._id] = item.count;
    }

    let activeCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    for (const [st, count] of Object.entries(byStatus)) {
      if (["COMPLETED", "DELIVERED"].includes(st)) {
        completedCount += count;
      } else if (["CANCELLED", "EXPIRED"].includes(st)) {
        cancelledCount += count;
      } else {
        activeCount += count;
      }
    }

    const stockMap = new Map();
    for (const s of stocks) {
      stockMap.set(`${String(s.product)}:${String(s.variant)}`, s);
    }

    const orders = ordersDocs.map((doc) => {
      const obj = doc.toObject({ virtuals: true });
      obj.stockPosition = calculateStockPosition(obj, stockMap);
      return obj;
    });

    return {
      orders,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        counts: {
          total: totalAllOrders,
          active: activeCount,
          completed: completedCount,
          cancelled: cancelledCount,
          pendingVerification: pendingVerificationCount,
          byStatus,
        },
      },
    };
  }
  async get(id, customer) {
    const order = await Order.findOne({
      _id: id,
      ...(customer ? { customer } : {}),
    });
    if (!order) throw AppError.notFound("Order not found");
    const stocks = await FinishedProductStock.find({}).lean();
    const stockMap = new Map();
    for (const s of stocks) {
      stockMap.set(`${String(s.product)}:${String(s.variant)}`, s);
    }
    const obj = order.toObject({ virtuals: true });
    obj.stockPosition = calculateStockPosition(obj, stockMap);
    return obj;
  }

  async fulfillFromStock(id, actor) {
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");

    if (order.status === S.CANCELLED) {
      throw AppError.badRequest("Cancelled orders cannot be fulfilled from stock");
    }
    if ([S.DELIVERED, S.COMPLETED].includes(order.status)) {
      throw AppError.badRequest("Order is already completed or delivered");
    }
    if (order.fulfillmentStatus === "FULFILLED_FROM_STOCK") {
      throw AppError.conflict("Order has already been fulfilled from finished stock");
    }

    const items = order.items || [];
    if (items.length === 0) {
      throw AppError.badRequest("Order contains no items to fulfill");
    }

    // Step 1: Pre-validate that all items have sufficient available stock
    const allocations = [];
    for (const item of items) {
      const prodId = item.productId?._id || item.productId || item.product;
      const varId = item.variantId || item.variant;
      const fc = (order.finishedCommitments || []).find(
        (c) => String(c.product) === String(prodId) && String(c.variant) === String(varId)
      );
      const alreadyCommitted = fc?.quantity || 0;
      const needed = Math.max(0, item.quantity - alreadyCommitted);

      if (needed > 0) {
        const stock = await FinishedProductStock.findOne({ product: prodId, variant: varId });
        const free = Math.max(0, (stock?.onHandQuantity || 0) - (stock?.reservedQuantity || 0));
        if (free < needed) {
          throw AppError.conflict(
            `Insufficient finished stock for "${item.productName || "Product"}". Required: ${needed}, Available: ${free}. Stock may have been allocated to another order.`
          );
        }
        allocations.push({ prodId, varId, needed, stockId: stock._id, item });
      }
    }

    // Step 2: Atomically reserve the needed quantities
    const rolledBack = [];
    try {
      for (const alloc of allocations) {
        const updated = await FinishedProductStock.findOneAndUpdate(
          {
            _id: alloc.stockId,
            $expr: {
              $lte: [
                { $add: ["$reservedQuantity", alloc.needed] },
                "$onHandQuantity",
              ],
            },
          },
          {
            $inc: { reservedQuantity: alloc.needed },
            $push: {
              history: {
                action: "ORDER_RESERVED",
                quantity: alloc.needed,
                previousOnHand: 0,
                newOnHand: 0,
                previousReserved: 0,
                newReserved: 0,
                referenceType: "ORDER",
                referenceId: order._id,
                note: `Order ${order.orderNumber} fulfilled from available finished stock.`,
                performedBy: actor?._id || null,
                timestamp: new Date(),
              },
            },
          },
          { new: true }
        );

        if (!updated) {
          throw AppError.conflict(
            `Stock reservation changed concurrently for "${alloc.item.productName || "Product"}". Please retry.`
          );
        }
        rolledBack.push(alloc);

        const fc = (order.finishedCommitments || []).find(
          (c) => String(c.product) === String(alloc.prodId) && String(c.variant) === String(alloc.varId)
        );
        if (fc) {
          fc.quantity += alloc.needed;
        } else {
          order.finishedCommitments.push({
            stock: alloc.stockId,
            product: alloc.prodId,
            variant: alloc.varId,
            quantity: alloc.needed,
          });
        }
      }
    } catch (err) {
      for (const alloc of rolledBack) {
        await FinishedProductStock.updateOne(
          { _id: alloc.stockId },
          {
            $inc: { reservedQuantity: -alloc.needed },
            $push: {
              history: {
                action: "ORDER_RELEASED",
                quantity: alloc.needed,
                previousOnHand: 0,
                newOnHand: 0,
                previousReserved: 0,
                newReserved: 0,
                referenceType: "ORDER",
                referenceId: order._id,
                note: `Rollback reservation for ${order.orderNumber} due to concurrency conflict.`,
                performedBy: actor?._id || null,
                timestamp: new Date(),
              },
            },
          }
        );
      }
      throw err;
    }

    // Release any raw ingredient reservations held by this order since baking is not required
    for (const line of order.ingredientCommitments || []) {
      await Ingredient.updateOne(
        { _id: line.ingredient, reservedStock: { $gte: line.quantity } },
        { $inc: { reservedStock: -line.quantity } }
      );
    }
    order.ingredientCommitments = [];

    // Release capacity commitment if any
    if (order.capacityCommitment && !order.capacityCommitment.released) {
      order.capacityCommitment.released = true;
    }

    // Update fulfillmentStatus and status (preserve payment status!)
    order.fulfillmentStatus = "FULFILLED_FROM_STOCK";
    if (order.status === S.CONFIRMED || order.status === S.IN_PRODUCTION) {
      order.status = S.READY;
    }

    await order.save();

    // Notify customer if exists
    if (order.customer) {
      await notificationService.createSafely({
        recipient: order.customer,
        type: "ORDER_STATUS_CHANGED",
        title: "Order Ready from Finished Stock",
        message: `Order ${order.orderNumber} is fulfilled directly from available finished stock and ready for ${order.orderType === "PICKUP" ? "pickup" : "delivery"}.`,
        relatedEntityType: "ORDER",
        relatedEntityId: order._id,
        dedupeKey: `order:${order._id}:FULFILLED_FROM_STOCK_${Date.now()}`,
      });
    }

    return order;
  }

  async markCustomerPaid(id, { screenshot, mimeType, fileName, paymentReference, transactionReference, amount, token, isReturningCustomer, user } = {}) {
    await this.expirePending();
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");

    if (order.isGuest) {
      if (!token || token !== order.guestTrackingToken)
        throw AppError.forbidden("A valid guest tracking token is required");
    } else if (!user || !order.customer?.equals(user._id)) {
      throw AppError.forbidden("Sign in to the account that owns this order");
    }
    if (order.paymentMethod !== "MANUAL_UPI")
      throw AppError.conflict("This order does not use manual UPI payment");
    const expectedAmount = Math.round(Number(order.total) * 100);
    const submittedAmount = Math.round(Number(amount) * 100);
    if (!Number.isFinite(submittedAmount) || submittedAmount !== expectedAmount)
      throw AppError.conflict("Submitted payment amount must match the order total");

    if (order.paymentStatus === "PENDING_VERIFICATION") {
      return order;
    }
    if (order.status !== S.PENDING_PAYMENT || order.paymentStatus !== "PAYMENT_PENDING")
      throw AppError.conflict("This order is no longer awaiting payment verification");

    // Screenshot is mandatory for first-time customers, optional for returning customers
    if (!screenshot && !paymentReference && !transactionReference) {
      const previousOrdersCount = await Order.countDocuments({
        $or: [
          { contactPhone: order.contactPhone },
          ...(order.customer ? [{ customer: order.customer }] : []),
        ],
        _id: { $ne: order._id },
      });
      if (previousOrdersCount === 0 && !isReturningCustomer) {
        throw AppError.badRequest("Payment screenshot is required for first-time customers");
      }
    }

    let proofDoc = null;
    let safeFileName = null;
    let detectedMime = mimeType || "image/png";

    if (screenshot) {
      let base64Data = screenshot;
      const dataUriMatch = screenshot.match(/^data:([a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
      if (dataUriMatch) {
        detectedMime = dataUriMatch[1].toLowerCase();
        base64Data = dataUriMatch[2];
      }

      if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(detectedMime)) {
        throw AppError.badRequest("Invalid file type. Payment screenshot must be a JPEG, PNG, or WEBP image.");
      }

      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length < 50) {
        throw AppError.badRequest("Uploaded screenshot file is empty or corrupted");
      }
      if (buffer.length > 10 * 1024 * 1024) {
        throw AppError.badRequest("Payment screenshot exceeds maximum allowable size of 10MB");
      }

      const ext = detectedMime === "image/png" ? "png" : detectedMime === "image/webp" ? "webp" : "jpg";
      safeFileName = fileName
        ? `${Date.now()}-${path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_")}`
        : `proof-${order.orderNumber}-${Date.now()}.${ext}`;

      const uploadedAt = new Date();
      const expiresAt = new Date(uploadedAt.getTime() + 30 * 24 * 60 * 60 * 1000); // 30-day retention

      proofDoc = await PaymentProof.create({
        order: order._id,
        fileName: safeFileName,
        mimeType: detectedMime,
        fileSize: buffer.length,
        data: buffer,
        uploadedAt,
        expiresAt,
        isDeleted: false,
      });

      // Write a local disk copy in uploads/payment-proofs if directory is accessible
      try {
        const uploadDir = path.resolve("uploads/payment-proofs");
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, safeFileName), buffer);
      } catch {
        // Disk write is best-effort secondary; MongoDB buffer is authoritative
      }
    }

    const refString = (
      paymentReference ||
      transactionReference ||
      (proofDoc
        ? `PROOFOR-ORD-${order.orderNumber}`
        : isReturningCustomer
        ? `RETURNING-${order.orderNumber}`
        : "")
    )
      .trim()
      .toUpperCase();

    const updateSet = {
      paymentStatus: "PENDING_VERIFICATION",
      paymentReportedAmount: Number(amount),
      customerPaidAt: new Date(),
    };

    if (refString) {
      updateSet.paymentReference = refString;
      updateSet.paymentReferenceKey = refString;
    }

    if (proofDoc) {
      updateSet.paymentProof = {
        proofId: proofDoc._id,
        fileName: safeFileName,
        mimeType: detectedMime,
        fileSize: proofDoc.fileSize,
        uploadedAt: proofDoc.uploadedAt,
        expiresAt: proofDoc.expiresAt,
        isDeleted: false,
        hasProof: true,
      };
    }

    const updated = await Order.findByIdAndUpdate(
      order._id,
      { $set: updateSet },
      { new: true, runValidators: true }
    );

    await this.notifyManagersForOrder(
      "ORDER_STATUS_CHANGED",
      "Payment Verification Required",
      `Order ${order.orderNumber} reported paid (${proofDoc ? "screenshot uploaded" : "returning customer awaiting verification"}). Action required: Inspect and verify payment in owner dashboard.`,
      updated,
    );

    return updated;
  }

  async getPaymentProof(orderId, user, token) {
    const order = await Order.findById(orderId);
    if (!order) throw AppError.notFound("Order not found");

    const isManager = Boolean(
      user &&
      [
        "OWNER_MANAGER",
        "OWNER",
        "MANAGER",
      ].includes(user.role)
    );

    const isOrderCustomer = Boolean(user && order.customer && order.customer.equals(user._id));
    const isOrderGuest = Boolean(token && token === order.guestTrackingToken);

    if (!isManager && !isOrderCustomer && !isOrderGuest) {
      throw AppError.forbidden("Access denied to this payment proof");
    }

    const proof = await PaymentProof.findOne({ order: order._id }).sort({ uploadedAt: -1 });

    if (!proof) {
      throw AppError.notFound("No payment screenshot has been uploaded for this order");
    }

    if (proof.isDeleted || (proof.expiresAt && proof.expiresAt <= new Date()) || !proof.data) {
      throw new AppError(
        "Payment screenshot has expired and was automatically deleted after 30 days in accordance with data retention policy. Order and verification audit records are preserved.",
        410
      );
    }

    return {
      data: proof.data,
      mimeType: proof.mimeType,
      fileName: proof.fileName,
      fileSize: proof.fileSize,
      uploadedAt: proof.uploadedAt,
      expiresAt: proof.expiresAt,
    };
  }

  async notifyManagersForOrder(type, title, message, order) {
    try {
      const supervisors = await User.find({
        role: { $in: ["OWNER_MANAGER", "OWNER", "MANAGER"] },
        isActive: true,
      }).select("_id");
      for (const supervisor of supervisors) {
        await notificationService.createSafely({
          recipient: supervisor._id,
          type,
          title,
          message,
          relatedEntityType: "ORDER",
          relatedEntityId: order._id,
          dedupeKey: `order-manager-notif:${order._id}:${type}:${Date.now()}`,
        });
      }
    } catch {
      // Non-critical notification failure should not block primary operations
    }
  }

  async confirmPayment(id, managerUserId, note = "") {
    await this.expirePending();
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");
    if (order.paymentStatus === "PAYMENT_CONFIRMED") return order;

    const verifiedAt = new Date();

    // Pay on Delivery (COD) collection recording
    if (order.paymentMethod === "COD" || order.paymentMethod === "PAY_ON_DELIVERY") {
      order.paymentStatus = "PAYMENT_CONFIRMED";
      order.paymentConfirmedBy = managerUserId;
      order.paymentConfirmedAt = verifiedAt;
      await order.save();

      await this.notifyManagersForOrder(
        "ORDER_STATUS_CHANGED",
        "Payment Collected",
        `Order ${order.orderNumber} Pay on Delivery collection recorded by staff/manager.`,
        order,
      );
      return order;
    }

    // Manual UPI payment verification
    if (order.paymentMethod === "MANUAL_UPI") {
      if (order.status !== S.PENDING_PAYMENT || order.paymentStatus !== "PENDING_VERIFICATION")
        throw AppError.conflict("Only a submitted manual UPI payment awaiting verification on a pending order can be verified");

      // Revalidate inventory availability before confirming acceptance
      const inventoryCheck = await orderFeasibilityService.checkOrder(order._id, { detailed: true });
      if (!inventoryCheck.feasible) {
        const details = (inventoryCheck.shortages || [])
          .map(
            (s) =>
              `${s.ingredientName}: required ${s.required} ${s.unit}, available ${s.available} ${s.unit}, shortage ${s.shortage} ${s.unit}`,
          )
          .join("; ");
        throw AppError.conflict(
          `Order cannot be accepted: insufficient inventory for required ingredients${details ? ` (${details})` : ""}`,
          inventoryCheck.shortages,
        );
      }

      const confirmedOrder = await this.transitionAtomically(order, S.CONFIRMED, {
        actor: managerUserId,
        reason: note || "Manual UPI payment verified by owner/manager",
        additionalOrderSet: {
          paymentStatus: "PAYMENT_CONFIRMED",
          paymentConfirmedBy: managerUserId,
          paymentConfirmedAt: verifiedAt,
          reservationExpiresAt: null,
        },
      });

      if (order.paymentProof?.proofId) {
        await PaymentProof.updateOne(
          { _id: order.paymentProof.proofId },
          { $set: { verifiedAt, verifiedBy: managerUserId } }
        );
      }

      await this.notifyManagersForOrder(
        "ORDER_STATUS_CHANGED",
        "Order Ready for Production",
        `Order ${order.orderNumber} payment confirmed. Ready for staff assignment and production planning.`,
        confirmedOrder,
      );

      return confirmedOrder;
    }

    throw AppError.badRequest("Payment verification not supported for this payment method");
  }

  async rejectPayment(id, managerUserId, note = "") {
    await this.expirePending();
    const order = await Order.findById(id);
    if (!order) throw AppError.notFound("Order not found");
    if (order.status === S.CANCELLED && order.paymentStatus === "PAYMENT_REJECTED") return order;
    if (order.status !== S.PENDING_PAYMENT || order.paymentMethod !== "MANUAL_UPI" || order.paymentStatus !== "PENDING_VERIFICATION")
      throw AppError.conflict("Only a submitted manual UPI payment awaiting verification on a pending order can be rejected");
    return this.transitionAtomically(order, S.CANCELLED, {
      actor: managerUserId,
      reason: note || "Manual UPI payment could not be verified",
      additionalOrderSet: { paymentStatus: "PAYMENT_REJECTED", reservationExpiresAt: null },
    });
  }

  async trackGuestOrder({ orderNumber, phone, token }) {
    if (!orderNumber) {
      throw AppError.badRequest("Order number is required");
    }

    const order = await Order.findOne({ orderNumber: orderNumber.trim() });
    if (!order) {
      throw AppError.notFound("Order not found with the specified order number");
    }

    // Secure verification: must match either phone or guest tracking token
    const normalizedQueryPhone = phone ? phone.replace(/\D/g, "") : "";
    const normalizedOrderPhone = order.contactPhone
      ? order.contactPhone.replace(/\D/g, "")
      : "";

    const phoneMatches =
      Boolean(normalizedQueryPhone) &&
      normalizedOrderPhone.includes(normalizedQueryPhone);
    const tokenMatches = Boolean(token) && order.guestTrackingToken === token;

    if (!phoneMatches && !tokenMatches) {
      throw AppError.forbidden(
        "Access denied: Contact phone number or secure tracking token is required and must match order details",
      );
    }

    // Return sanitized, customer-safe details
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus:
        order.paymentStatus ||
        (order.paymentMethod === "COD" ? "PENDING" : "PAYMENT_PENDING"),
      paymentReference: order.paymentReference || "",
      items: order.items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId,
        productName: it.productName,
        variantName: it.variantName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        specialInstructions: it.specialInstructions,
      })),
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      orderType: order.orderType,
      deliveryAddress: order.deliveryAddress,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      estimatedReadyAt: order.estimatedReadyAt,
      createdAt: order.createdAt,
      customerPaidAt: order.customerPaidAt,
      paymentConfirmedAt: order.paymentConfirmedAt,
    };
  }
}
export const orderService = new OrderService();
export default orderService;
