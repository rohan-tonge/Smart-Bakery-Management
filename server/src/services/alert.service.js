import { inventoryService } from "./inventory.service.js";
import ProductionBatch from "../models/productionBatch.model.js";
import WastageRecord from "../models/wastageRecord.model.js";
import Complaint from "../models/complaint.model.js";
import Order from "../models/order.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import { USER_ROLES } from "../utils/constants.js";
const HIGH_WASTAGE_RATE = 0.1;
class AlertService {
  async list(user) {
    const staff = user.role === USER_ROLES.PRODUCTION_STAFF;
    const now = new Date(),
      expiringFilter = {
        status: "AVAILABLE",
        remainingQuantity: { $gt: 0 },
        expiryDate: { $gt: now, $lte: new Date(now.getTime() + 30 * 86400000) },
      };
    const [
      stock,
      expiring,
      expiringCount,
      batches,
      complaints,
      pending,
      wasteRows,
    ] = await Promise.all([
      inventoryService.getStockPage({
        page: 1,
        limit: 1000,
        lowStockOnly: true,
      }),
      InventoryLot.find(expiringFilter)
        .sort({ expiryDate: 1 })
        .limit(1000)
        .populate("ingredient", "name unit"),
      InventoryLot.countDocuments(expiringFilter),
      ProductionBatch.find(
        staff
          ? {
              "assignedWorkers.worker": user._id,
              status: {
                $in: [
                  "PLANNED",
                  "ACCEPTED",
                  "VERIFIED",
                  "IN_PRODUCTION",
                  "QUALITY_CHECK",
                  "QUALITY_FAILED",
                  "PACKAGING",
                  "REJECTED",
                  "COMPLETED",
                  "PACKAGED",
                  "DELIVERED",
                ],
              },
            }
          : {
              status: {
                $in: [
                  "PLANNED",
                  "ACCEPTED",
                  "VERIFIED",
                  "IN_PRODUCTION",
                  "QUALITY_CHECK",
                  "QUALITY_FAILED",
                  "PACKAGING",
                  "REJECTED",
                  "COMPLETED",
                  "PACKAGED",
                  "DELIVERED",
                ],
              },
            },
      ).select(
        "batchNumber status plannedStartTime assignedWorkers productSnapshot producedQuantity planningStatus productionDate planningFeasibility",
      ),
      staff
        ? []
        : Complaint.find({
            status: { $in: ["OPEN", "IN_REVIEW"] },
            priority: "URGENT",
          }).select("_id category status priority createdAt"),
      staff
        ? []
        : Order.find({
            status: { $in: ["PENDING_PAYMENT", "EXPIRED"] },
            reservationExpiresAt: { $lte: now },
          }).select("orderNumber status"),
      staff
        ? []
        : WastageRecord.aggregate([
            { $match: { type: "PRODUCTION_OUTPUT", status: "RECORDED" } },
            {
              $group: {
                _id: "$productionBatch",
                quantity: { $sum: "$quantity" },
              },
            },
          ]),
    ]);
    const production = batches
      .filter((b) => ["PLANNED", "ACCEPTED", "VERIFIED", "IN_PRODUCTION", "QUALITY_CHECK", "QUALITY_FAILED", "PACKAGING", "REJECTED"].includes(b.status))
      .map((b) => ({
        type: b.status === "QUALITY_FAILED" ? "QUALITY_FAILURE" : b.status === "REJECTED" ? "BATCH_REJECTED" : "PRODUCTION",
        batchId: b._id,
        batchNumber: b.batchNumber,
        status: b.status,
        ...(b.status === "QUALITY_FAILED" ? { qualityFailure: true } : {}),
        product: b.productSnapshot?.productName,
        delayed:
          !!b.plannedStartTime &&
          b.plannedStartTime < now &&
          ["PLANNED", "ACCEPTED", "VERIFIED"].includes(b.status),
      }));
    const wastedByBatch = new Map(
      wasteRows.map((row) => [String(row._id), row.quantity]),
    );
    const highWastage = batches
      .filter(
        (b) =>
          b.producedQuantity > 0 &&
          (wastedByBatch.get(String(b._id)) || 0) / b.producedQuantity >=
            HIGH_WASTAGE_RATE,
      )
      .map((b) => ({
        batchId: b._id,
        batchNumber: b.batchNumber,
        product: b.productSnapshot?.productName,
        wastageQuantity: wastedByBatch.get(String(b._id)),
        producedQuantity: b.producedQuantity,
      }));
    const orderNeededPlans = staff ? [] : batches
      .filter((batch) => batch.planningFeasibility?.ingredients?.shortages?.length)
      .map((batch) => ({
        type: "ORDER_NEEDED",
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        productionDate: batch.productionDate,
        shortages: batch.planningFeasibility.ingredients.shortages,
      }));
    return {
      ...(staff
        ? {}
        : {
            lowStock: stock.items,
            lowStockCount: stock.meta.total,
            expiring,
            expiringCount,
            urgentComplaints: complaints,
            unpaidExpiredOrders: pending,
            highWastageBatches: highWastage,
            orderNeededPlans,
          }),
      production,
    };
  }
}
export const alertService = new AlertService();
export default alertService;
