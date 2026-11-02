import Setting from "../models/setting.model.js";
import User from "../models/user.model.js";
import Order from "../models/order.model.js";
import AppError from "../utils/appError.js";
import { USER_ROLES } from "../utils/constants.js";

const KEY = "PRODUCTION_CAPACITY";
const activeOrderStatuses = ["PENDING_PAYMENT", "CONFIRMED", "IN_PRODUCTION", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
const dayKey = (date = new Date()) => date.toISOString().slice(0, 10).replaceAll("-", "");
const minutes = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};
const configuredMinutes = (value) => {
  if (!value || !Array.isArray(value.ovens) || !value.ovens.length || !value.workingHours || !Number.isInteger(value.minutesPerStaffPerDay)) return null;
  const workdayMinutes = minutes(value.workingHours.close) - minutes(value.workingHours.open);
  if (workdayMinutes <= 0 || !Number.isInteger(value.slotMinutes) || value.slotMinutes <= 0 || value.slotMinutes > workdayMinutes) return null;
  if (value.ovens.some((oven) => !oven.name || !Number.isInteger(oven.minutesPerDay) || oven.minutesPerDay <= 0 || oven.minutesPerDay > workdayMinutes)) return null;
  if (value.minutesPerStaffPerDay <= 0 || value.minutesPerStaffPerDay > workdayMinutes) return null;
  return value;
};

class CapacityService {
  async getConfiguration() {
    const setting = await Setting.findOne({ key: KEY }).lean();
    return setting ? { ...setting.value, updatedAt: setting.updatedAt } : null;
  }

  async updateConfiguration(input, userId) {
    const value = configuredMinutes(input);
    if (!value) throw AppError.badRequest("Capacity settings must include at least one oven, valid working hours, and positive daily oven, staff, and slot minutes within the workday");
    const staffCount = await User.countDocuments({ role: USER_ROLES.PRODUCTION_STAFF, isActive: true });
    const dailyLimit = Math.min(value.ovens.reduce((sum, oven) => sum + oven.minutesPerDay, 0), staffCount * value.minutesPerStaffPerDay);
    const existing = await Setting.findOne({ key: KEY }).lean();
    const currentKey = dayKey();
    const reservedToday = Number(existing?.value?.reservedByDay?.[currentKey] || 0);
    if (dailyLimit < reservedToday) throw AppError.conflict("The new capacity is below work already reserved today");
    value.reservedByDay = existing?.value?.reservedByDay || {};
    const doc = await Setting.findOneAndUpdate(
      { key: KEY },
      { $set: { value, description: "Owner-configured production capacity", updatedBy: userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return doc.value;
  }

  async assess({ productionRequired, estimatedMinutes = 0, maxTaskMinutes = 0, date = new Date() }) {
    if (!productionRequired) return { status: "NOT_REQUIRED", estimatedReadyAt: date, reason: "Finished stock covers this order" };
    const setting = await Setting.findOne({ key: KEY }).lean();
    const value = configuredMinutes(setting?.value);
    if (!value) return { status: "NOT_CONFIGURED", estimatedReadyAt: null, reason: "An owner must configure production ovens, working hours, slot length, and staff minutes before accepting made-to-order items" };
    const staffCount = await User.countDocuments({ role: USER_ROLES.PRODUCTION_STAFF, isActive: true });
    if (!staffCount) return { status: "STAFF_UNAVAILABLE", estimatedReadyAt: null, reason: "No active production staff are available" };
    const limit = Math.min(value.ovens.reduce((sum, oven) => sum + oven.minutesPerDay, 0), staffCount * value.minutesPerStaffPerDay);
    const key = dayKey(date);
    const active = await Order.aggregate([
      { $match: { status: { $in: activeOrderStatuses }, "capacityCommitment.date": key, "capacityCommitment.released": { $ne: true } } },
      { $group: { _id: null, minutes: { $sum: "$capacityCommitment.minutes" } } },
    ]);
    const reserved = Number(setting.value.reservedByDay?.[key] || active[0]?.minutes || 0);
    if (maxTaskMinutes > value.slotMinutes) return { status: "NO_PRODUCTION_SLOT", estimatedReadyAt: null, reason: `A production task needs ${maxTaskMinutes} minutes, longer than the configured ${value.slotMinutes}-minute slot`, capacityMinutes: limit, reservedMinutes: reserved };
    if (estimatedMinutes <= 0) return { status: "INVALID_WORKLOAD", estimatedReadyAt: null, reason: "The product recipe must define a positive preparation or production duration" };
    if (reserved + estimatedMinutes > limit) return { status: "CAPACITY_FULL", estimatedReadyAt: null, reason: `Only ${Math.max(0, limit - reserved)} of ${limit} daily production minutes remain`, capacityMinutes: limit, reservedMinutes: reserved };
    return {
      status: "AVAILABLE",
      reason: "Configured oven, staff, slot, and daily capacity are sufficient",
      capacityMinutes: limit,
      reservedMinutes: reserved,
      estimatedReadyAt: new Date(date.getTime() + estimatedMinutes * 60_000),
      reservationDate: key,
      reservationMinutes: estimatedMinutes,
    };
  }

  async reserve({ dateKey, minutes: requested, session = null }) {
    if (!Number.isInteger(requested) || requested <= 0) return null;
    const setting = await Setting.findOne({ key: KEY }).session(session).lean();
    const value = configuredMinutes(setting?.value);
    if (!setting || !value) throw AppError.conflict("Production capacity is not configured. Ask the bakery owner to complete Production Capacity settings.");
    const staffCount = await User.countDocuments({ role: USER_ROLES.PRODUCTION_STAFF, isActive: true }).session(session);
    const capacityLimit = Math.min(value.ovens.reduce((sum, oven) => sum + oven.minutesPerDay, 0), staffCount * value.minutesPerStaffPerDay);
    const path = `value.reservedByDay.${dateKey}`;
    const updated = await Setting.findOneAndUpdate(
      { _id: setting._id, $expr: { $lte: [{ $add: [{ $ifNull: [`$${path}`, 0] }, requested] }, capacityLimit] } },
      { $inc: { [path]: requested } },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!updated) throw AppError.conflict("Production capacity filled while this order was being placed; choose another time or try later");
    return { date: dateKey, minutes: requested };
  }

  async release({ dateKey, minutes: requested, session = null }) {
    if (!dateKey || !Number.isInteger(requested) || requested <= 0) return false;
    const path = `value.reservedByDay.${dateKey}`;
    const result = await Setting.updateOne(
      { key: KEY, [path]: { $gte: requested } },
      { $inc: { [path]: -requested } },
      session ? { session } : {},
    );
    if (!result.modifiedCount) throw AppError.conflict("Production capacity reservation is inconsistent; manual reconciliation is required");
    return true;
  }
}

export const capacityService = new CapacityService();
export default capacityService;
