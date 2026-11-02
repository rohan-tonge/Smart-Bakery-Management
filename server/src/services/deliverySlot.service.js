import crypto from "node:crypto";
import Order from "../models/order.model.js";
import DeliverySlotReservation from "../models/deliverySlotReservation.model.js";
import orderFeasibilityService from "./order-feasibility.service.js";
import capacityService from "./capacity.service.js";
import AppError from "../utils/appError.js";
import { getBakeryTodayString, isDateNextDayOrLater } from "../utils/date.utils.js";

const MAX_DELIVERY_ORDERS_PER_SLOT = 5;
const MAX_PICKUP_ORDERS_PER_SLOT = 10;

const DEFAULT_SLOTS = [
  { id: "SLOT_09_12", startTime: "09:00", endTime: "12:00", label: "Morning (9:00 AM - 12:00 PM)" },
  { id: "SLOT_12_15", startTime: "12:00", endTime: "15:00", label: "Afternoon (12:00 PM - 3:00 PM)" },
  { id: "SLOT_15_18", startTime: "15:00", endTime: "18:00", label: "Evening (3:00 PM - 6:00 PM)" },
  { id: "SLOT_18_21", startTime: "18:00", endTime: "21:00", label: "Night (6:00 PM - 9:00 PM)" },
];

export class DeliverySlotService {
  getSlotId(date, timeSlot, orderType = "DELIVERY") {
    return `${date}_${timeSlot}_${orderType}`;
  }

  /**
   * Synchronize existing active orders into the slot reservation document if needed.
   * Ensures pre-existing orders are respected and atomic operations have a valid baseline.
   */
  async syncSlotCapacity(date, timeSlot, orderType = "DELIVERY", maxOrdersPerSlot = MAX_DELIVERY_ORDERS_PER_SLOT) {
    const slotId = this.getSlotId(date, timeSlot, orderType);
    let doc = await DeliverySlotReservation.findById(slotId);
    const now = new Date();
    const existingOrders = await Order.find({
      deliveryDate: date,
      deliveryTimeSlot: timeSlot,
      ...(orderType ? { orderType } : {}),
      status: { $in: ["PENDING_PAYMENT", "CONFIRMED", "IN_PRODUCTION", "READY", "OUT_FOR_DELIVERY"] },
      $or: [
        { status: { $ne: "PENDING_PAYMENT" } },
        { reservationExpiresAt: { $gt: now } },
      ],
    });

    if (!doc) {
      try {
        doc = await DeliverySlotReservation.create({
          _id: slotId,
          date,
          timeSlot,
          orderType,
          maxCapacity: maxOrdersPerSlot,
          reservedCount: existingOrders.length,
          reservations: existingOrders.map((o) => ({
            token: o.deliverySlotReservation?.token || crypto.randomUUID(),
            orderId: o._id,
            orderNumber: o.orderNumber,
            status: "COMMITTED",
            createdAt: o.createdAt || new Date(),
          })),
        });
      } catch {
        doc = await DeliverySlotReservation.findById(slotId);
      }
    } else {
      if (existingOrders.length > doc.reservedCount) {
        doc = await DeliverySlotReservation.findByIdAndUpdate(
          slotId,
          { $set: { reservedCount: existingOrders.length } },
          { new: true }
        );
      }
    }
    return doc;
  }

  /**
   * Get configured or standard slots
   */
  async getSlotDefinitions() {
    try {
      const config = await capacityService.getConfiguration();
      if (config?.workingHours && config.slotMinutes) {
        const openHour = Number(config.workingHours.open.slice(0, 2));
        const closeHour = Number(config.workingHours.close.slice(0, 2));
        const stepHours = Math.max(1, Math.round(config.slotMinutes / 60));

        const dynamicSlots = [];
        for (let h = openHour; h < closeHour; h += stepHours) {
          const start = `${String(h).padStart(2, "0")}:00`;
          const endHour = Math.min(closeHour, h + stepHours);
          const end = `${String(endHour).padStart(2, "0")}:00`;
          const slotId = `SLOT_${start.replace(":", "")}_${end.replace(":", "")}`;
          dynamicSlots.push({
            id: slotId,
            startTime: start,
            endTime: end,
            label: `${start} - ${end}`,
          });
        }
        if (dynamicSlots.length > 0) return dynamicSlots;
      }
    } catch {
      // Use standard default slots
    }
    return DEFAULT_SLOTS;
  }

  /**
   * Calculate available delivery / pickup slots for the given cart items over the next 7 days
   */
  async getAvailableSlots({ items = [], orderType = "DELIVERY", daysAhead = 7, feasibility: passedFeasibility = null } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        feasible: true,
        orderType,
        earliestReadyAt: new Date(),
        days: [],
        availableSlots: [],
      };
    }

    // 1. Evaluate stock, ingredients, and production feasibility
    const feasibility = passedFeasibility || await orderFeasibilityService.check(items, { detailed: true });

    if (!feasibility.feasible) {
      return {
        feasible: false,
        orderType,
        reason: feasibility.checks?.capacityReason || (feasibility.shortages?.length ? "Ingredient shortage prevents production for made-to-order items" : "Selected products are unavailable"),
        shortages: feasibility.shortages || [],
        days: [],
        availableSlots: [],
      };
    }

    const productionRequired = Boolean(feasibility.production?.required);
    const now = new Date();

    // Determine earliest ready time
    let earliestReadyAt;
    if (!productionRequired) {
      // Finished stock exists; only packing buffer needed (~30 minutes)
      earliestReadyAt = new Date(now.getTime() + 30 * 60 * 1000);
    } else {
      // Production needed; ready time derived from feasibility capacity
      earliestReadyAt = feasibility.estimatedReadyAt ? new Date(feasibility.estimatedReadyAt) : new Date(now.getTime() + 120 * 60 * 1000);
    }

    const slotDefs = await this.getSlotDefinitions();
    const maxOrdersPerSlot = orderType === "PICKUP" ? MAX_PICKUP_ORDERS_PER_SLOT : MAX_DELIVERY_ORDERS_PER_SLOT;

    const days = [];
    const allAvailableSlots = [];

    // Next-day-onward ordering: Check calendar days strictly starting from tomorrow (dayOffset = 1)
    const todayStr = getBakeryTodayString();
    const [todayY, todayM, todayD] = todayStr.split("-").map(Number);

    for (let dayOffset = 1; dayOffset <= daysAhead; dayOffset++) {
      const targetDate = new Date(Date.UTC(todayY, todayM - 1, todayD + dayOffset));
      const dateStr = targetDate.toISOString().slice(0, 10); // YYYY-MM-DD

      // Assess capacity for target date if production is required
      let dayCapacityOk = true;
      let dayCapacityReason = "";
      if (productionRequired) {
        try {
          const capAssessment = await capacityService.assess({
            productionRequired: true,
            estimatedMinutes: feasibility.capacity?.reservationMinutes || 60,
            date: targetDate,
          });
          if (capAssessment.status === "CAPACITY_FULL") {
            dayCapacityOk = false;
            dayCapacityReason = capAssessment.reason || "Daily bakery capacity full";
          }
        } catch {
          // If capacity service encounters an issue, proceed with standard reservations check
        }
      }

      const daySlots = [];

      for (const def of slotDefs) {
        const timeSlotString = `${def.startTime} - ${def.endTime}`;

        // Construct slot start and end dates in local / UTC context
        const [startH, startM] = def.startTime.split(":").map(Number);
        const [endH, endM] = def.endTime.split(":").map(Number);

        const slotStartTime = new Date(targetDate);
        slotStartTime.setHours(startH, startM, 0, 0);

        const slotEndTime = new Date(targetDate);
        slotEndTime.setHours(endH, endM, 0, 0);

        let available = true;
        let reason = "";

        if (!dayCapacityOk) {
          available = false;
          reason = dayCapacityReason;
        } else if (now >= slotEndTime) {
          available = false;
          reason = "Time slot has ended";
        } else if (now.getTime() + 30 * 60 * 1000 > slotEndTime.getTime()) {
          available = false;
          reason = "Order cutoff time for this slot has passed";
        } else if (earliestReadyAt.getTime() > slotEndTime.getTime()) {
          available = false;
          reason = "Baking / preparation cannot complete before slot ends";
        }

        // If time-wise available, check active order reservations to prevent overbooking
        let remainingSpots = maxOrdersPerSlot;
        if (available) {
          const slotId = this.getSlotId(dateStr, timeSlotString, orderType);
          const existingReservations = await Order.countDocuments({
            deliveryDate: dateStr,
            deliveryTimeSlot: timeSlotString,
            status: { $in: ["PENDING_PAYMENT", "CONFIRMED", "IN_PRODUCTION", "READY", "OUT_FOR_DELIVERY"] },
            $or: [
              { status: { $ne: "PENDING_PAYMENT" } },
              { reservationExpiresAt: { $gt: now } },
            ],
          });
          const slotDoc = await DeliverySlotReservation.findById(slotId);
          const currentReserved = Math.max(existingReservations, slotDoc?.reservedCount || 0);

          remainingSpots = Math.max(0, maxOrdersPerSlot - currentReserved);

          if (currentReserved >= maxOrdersPerSlot) {
            available = false;
            reason = "Slot is fully booked";
          }
        }

        const slotObj = {
          slotId: def.id,
          slot: timeSlotString,
          date: dateStr,
          timeSlot: timeSlotString,
          label: def.label,
          startTime: def.startTime,
          endTime: def.endTime,
          available,
          isAvailable: available,
          remainingSpots,
          spotsRemaining: remainingSpots,
          reason,
        };

        daySlots.push(slotObj);

        if (available) {
          allAvailableSlots.push(slotObj);
        }
      }

      days.push({
        date: dateStr,
        dayName: targetDate.toLocaleDateString("en-US", { weekday: "short" }),
        formattedDate: `${targetDate.toLocaleDateString("en-US", { weekday: "short" })}, ${targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        isToday: dayOffset === 0,
        isFeasible: dayCapacityOk,
        slots: daySlots,
      });
    }

    return {
      feasible: true,
      orderType,
      earliestReadyAt,
      productionRequired,
      days,
      dates: days,
      availableSlots: allAvailableSlots,
      firstAvailableSlot: allAvailableSlots[0] || null,
    };
  }

  /**
   * Revalidate slot availability during checkout and prevent concurrent overbooking
   */
  async validateAndReserveSlot({ date, timeSlot, orderType = "DELIVERY", items = [], feasibility = null } = {}) {
    if (!date || !timeSlot) {
      throw AppError.badRequest("Please select a delivery date and time slot");
    }

    if (!isDateNextDayOrLater(date)) {
      throw AppError.badRequest("Orders must be scheduled at least one day in advance. Select tomorrow or a later date.");
    }

    const availability = await this.getAvailableSlots({ items, orderType, daysAhead: 7, feasibility });

    if (!availability.feasible) {
      throw AppError.conflict(availability.reason || "Selected items cannot be fulfilled");
    }

    // Find the requested slot in availability calculations
    const requestedSlot = availability.availableSlots.find(
      (s) => s.date === date && (s.timeSlot === timeSlot || s.label === timeSlot)
    );

    if (!requestedSlot || !requestedSlot.available) {
      // Find up to 3 alternative available slots
      const alternatives = availability.availableSlots.slice(0, 3).map((s) => ({
        date: s.date,
        timeSlot: s.timeSlot,
        label: s.label,
      }));

      throw AppError.conflict(
        `The selected delivery slot (${date} ${timeSlot}) is not available: ${requestedSlot?.reason || "fully booked or past cutoff"}.`,
        { alternatives }
      );
    }

    // Concurrency protection: Atomic reservation at the database level
    const maxOrdersPerSlot = orderType === "PICKUP" ? MAX_PICKUP_ORDERS_PER_SLOT : MAX_DELIVERY_ORDERS_PER_SLOT;
    await this.syncSlotCapacity(date, requestedSlot.timeSlot, orderType, maxOrdersPerSlot);

    const slotId = this.getSlotId(date, requestedSlot.timeSlot, orderType);
    const token = crypto.randomUUID();

    const reservedDoc = await DeliverySlotReservation.findOneAndUpdate(
      {
        _id: slotId,
        reservedCount: { $lt: maxOrdersPerSlot },
      },
      {
        $inc: { reservedCount: 1 },
        $push: {
          reservations: {
            token,
            orderId: null,
            status: "RESERVED",
            createdAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!reservedDoc) {
      const alternatives = availability.availableSlots
        .filter((s) => !(s.date === date && s.timeSlot === requestedSlot.timeSlot))
        .slice(0, 3)
        .map((s) => ({
          date: s.date,
          timeSlot: s.timeSlot,
          label: s.label,
        }));

      throw AppError.conflict(
        `The delivery slot for ${date} (${requestedSlot.timeSlot}) just became fully booked by another order. Please choose an alternative slot.`,
        alternatives
      );
    }

    return {
      deliveryDate: date,
      deliveryTimeSlot: requestedSlot.timeSlot,
      token,
      reservationId: reservedDoc._id,
      orderType,
    };
  }

  /**
   * Associate an order with its reserved slot
   */
  async commitSlotReservation({ date, timeSlot, orderType = "DELIVERY", token, orderId, orderNumber }) {
    if (!token) return null;
    const slotId = this.getSlotId(date, timeSlot, orderType);
    return DeliverySlotReservation.updateOne(
      { _id: slotId, "reservations.token": token },
      {
        $set: {
          "reservations.$.orderId": orderId,
          "reservations.$.orderNumber": orderNumber,
          "reservations.$.status": "COMMITTED",
        },
      }
    );
  }

  /**
   * Release reserved capacity when checkout fails, or when an order is cancelled or expires
   */
  async releaseSlotReservation({ date, timeSlot, orderType = "DELIVERY", token, orderId }) {
    if (!date || !timeSlot) return null;
    const slotId = this.getSlotId(date, timeSlot, orderType);

    const query = {
      _id: slotId,
      reservedCount: { $gt: 0 },
    };

    if (token) {
      query["reservations.token"] = token;
      query["reservations.status"] = { $ne: "RELEASED" };
    } else if (orderId) {
      query["reservations.orderId"] = orderId;
      query["reservations.status"] = { $ne: "RELEASED" };
    } else {
      return DeliverySlotReservation.findOneAndUpdate(
        { _id: slotId, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1 } },
        { new: true }
      );
    }

    const updated = await DeliverySlotReservation.findOneAndUpdate(
      query,
      {
        $inc: { reservedCount: -1 },
        $set: {
          "reservations.$.status": "RELEASED",
          "reservations.$.releasedAt": new Date(),
        },
      },
      { new: true }
    );
    return updated;
  }

  /**
   * Reacquire reserved capacity during rollback of a failed transition
   */
  async reacquireSlotReservation({ date, timeSlot, orderType = "DELIVERY", token, orderId }) {
    if (!date || !timeSlot) return null;
    const slotId = this.getSlotId(date, timeSlot, orderType);
    const query = { _id: slotId };
    if (token) {
      query["reservations.token"] = token;
      query["reservations.status"] = "RELEASED";
    } else if (orderId) {
      query["reservations.orderId"] = orderId;
      query["reservations.status"] = "RELEASED";
    }

    return DeliverySlotReservation.findOneAndUpdate(
      query,
      {
        $inc: { reservedCount: 1 },
        $set: {
          "reservations.$.status": "COMMITTED",
          "reservations.$.releasedAt": null,
        },
      },
      { new: true }
    );
  }
}

export const deliverySlotService = new DeliverySlotService();
export default deliverySlotService;
