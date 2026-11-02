import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import ProductionBatch from "../models/productionBatch.model.js";
import InventoryLot from "../models/inventoryLot.model.js";
import Ingredient from "../models/ingredient.model.js";
import InventoryTransaction from "../models/inventoryTransaction.model.js";
import WastageRecord from "../models/wastageRecord.model.js";
import Complaint from "../models/complaint.model.js";
import Feedback from "../models/feedback.model.js";
import User from "../models/user.model.js";
import { inventoryService } from "./inventory.service.js";
import {
  rupeesToPaise,
  paiseToRupees,
  sumSafePaise,
  multiplyQuantityByRupees,
} from "../utils/money.utils.js";
import { USER_ROLES } from "../utils/constants.js";
const isManager = (u) =>
  Boolean(
    u &&
      [
        USER_ROLES.OWNER_MANAGER,
        USER_ROLES.OWNER,
        USER_ROLES.MANAGER,
        "OWNER",
        "MANAGER",
      ].includes(u.role),
  );
const isOwner = (u) => Boolean(u && [USER_ROLES.OWNER_MANAGER, USER_ROLES.OWNER].includes(u.role));
const range = ({ from, to } = {}) => ({
  ...(from ? { $gte: new Date(from) } : {}),
  ...(to ? { $lte: new Date(to) } : {}),
});
const withDate = (query, field, dates) =>
  Object.keys(range(dates)).length
    ? { ...query, [field]: range(dates) }
    : query;
const bucket = (d, group) => {
  const x = new Date(d);
  if (group === "month")
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
  if (group === "week") {
    const day = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - day);
    return x.toISOString().slice(0, 10);
  }
  return x.toISOString().slice(0, 10);
};
const paise = (r) => rupeesToPaise(r || 0);
const safePaise = (r) => (typeof r === "number" && r > 0 ? rupeesToPaise(r) : 0);
const safeRupees = (p) => (typeof p === "number" && Number.isFinite(p) ? paiseToRupees(p) : 0);
class AnalyticsService {
  async satisfaction(dates = {}, group = "day") {
    const rows = await Feedback.find(withDate({ status: "APPROVED" }, "createdAt", dates))
      .select("rating criteria createdAt")
      .lean();
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const criteria = new Map();
    const trend = new Map();
    let sum = 0;
    for (const row of rows) {
      sum += row.rating;
      distribution[row.rating] += 1;
      for (const item of row.criteria || []) {
        const key = item.name.trim();
        if (!key) continue;
        const scores = criteria.get(key) || { sum: 0, count: 0 };
        scores.sum += item.rating;
        scores.count += 1;
        criteria.set(key, scores);
      }
      const period = bucket(row.createdAt, group);
      const item = trend.get(period) || { period, ratingTotal: 0, count: 0 };
      item.ratingTotal += row.rating;
      item.count += 1;
      trend.set(period, item);
    }
    return {
      totalRatings: rows.length,
      averageRating: rows.length ? Number((sum / rows.length).toFixed(2)) : null,
      distribution,
      criteriaAverages: Object.fromEntries([...criteria.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Number((value.sum / value.count).toFixed(2))])),
      trend: [...trend.values()].map(({ period, ratingTotal, count }) => ({ period, count, averageRating: Number((ratingTotal / count).toFixed(2)) })).sort((a, b) => a.period.localeCompare(b.period)),
    };
  }
  async paidOrders(dates = {}) {
    const orders = await Order.find(
      withDate(
        { status: { $nin: ["CANCELLED", "EXPIRED"] } },
        "createdAt",
        dates,
      ),
    ).select("items createdAt");
    const ids = orders.map((o) => o._id);
    const payments = await Payment.find({
      order: { $in: ids },
      status: "CAPTURED",
    }).select("order");
    const paid = new Set(payments.map((p) => String(p.order)));
    return orders.filter((o) => paid.has(String(o._id)));
  }
  async sales(dates = {}, group = "day") {
    const [totalOrders, paid, cancelled] = await Promise.all([
      Order.countDocuments(withDate({}, "createdAt", dates)),
      this.paidOrders(dates),
      Order.countDocuments(
        withDate({ status: "CANCELLED" }, "createdAt", dates),
      ),
    ]);
    let revenuePaise = 0;
    const trendMap = new Map();
    for (const o of paid) {
      const revenue = o.items.reduce((s, i) => s + paise(i.lineTotal), 0);
      revenuePaise = sumSafePaise([revenuePaise, revenue]);
      const k = bucket(o.createdAt, group);
      const v = trendMap.get(k) || {
        period: k,
        orders: 0,
        paidOrders: 0,
        revenuePaise: 0,
      };
      v.orders++;
      v.paidOrders++;
      v.revenuePaise = sumSafePaise([v.revenuePaise, revenue]);
      trendMap.set(k, v);
    }
    return {
      totalOrders,
      paidOrders: paid.length,
      revenuePaise,
      averageOrderValuePaise: paid.length
        ? Math.round(revenuePaise / paid.length)
        : null,
      cancelledOrders: cancelled,
      trend: [...trendMap.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
    };
  }
  async orders(dates = {}, group = "day") {
    const list = await Order.find(withDate({}, "createdAt", dates)).select(
      "status paymentSummary orderType items createdAt",
    );
    const statuses = {},
      payments = {},
      fulfillment = {},
      trendMap = new Map();
    let quantity = 0,
      itemCount = 0;
    for (const o of list) {
      statuses[o.status] = (statuses[o.status] || 0) + 1;
      const ps = o.paymentSummary?.status || "UNKNOWN";
      payments[ps] = (payments[ps] || 0) + 1;
      fulfillment[o.orderType] = (fulfillment[o.orderType] || 0) + 1;
      itemCount += o.items.length;
      quantity += o.items.reduce((s, i) => s + i.quantity, 0);
      const k = bucket(o.createdAt, group);
      const v = trendMap.get(k) || { period: k, count: 0 };
      v.count++;
      trendMap.set(k, v);
    }
    return {
      totalOrders: list.length,
      byStatus: statuses,
      byPaymentStatus: payments,
      byFulfillmentType: fulfillment,
      cancelledOrders: statuses.CANCELLED || 0,
      averageLineCount: list.length
        ? Number((itemCount / list.length).toFixed(2))
        : null,
      averageItemQuantity: list.length
        ? Number((quantity / list.length).toFixed(2))
        : null,
      trend: [...trendMap.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
    };
  }
  async products(dates = {}, productId, variantId, user) {
    const paid = await this.paidOrders(dates);
    const map = new Map();
    for (const o of paid)
      for (const line of o.items) {
        if (
          (productId && String(line.productId) !== String(productId)) ||
          (variantId && String(line.variantId) !== String(variantId))
        )
          continue;
        const key = `${line.productId}:${line.variantId}`;
        const x = map.get(key) || {
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          variantName: line.variantName,
          quantitySold: 0,
          revenuePaise: 0,
          orderIds: new Set(),
        };
        x.quantitySold += line.quantity;
        x.revenuePaise = sumSafePaise([x.revenuePaise, paise(line.lineTotal)]);
        x.orderIds.add(String(o._id));
        map.set(key, x);
      }
    const batches = await ProductionBatch.find({
      ...(productId ? { product: productId } : {}),
      ...(variantId ? { productVariant: variantId } : {}),
      status: { $in: ["QUALITY_CHECK", "QUALITY_FAILED", "PACKAGING", "PACKAGED", "COMPLETED", "DELIVERED"] },
      ...(Object.keys(range(dates)).length
        ? { actualCompletionTime: range(dates) }
        : {}),
    }).select(
      "product productVariant productSnapshot producedQuantity usableQuantity wastageQuantity",
    );
    for (const b of batches) {
      const key = `${b.product}:${b.productVariant}`;
      if (!map.has(key))
        map.set(key, {
          productId: b.product,
          variantId: b.productVariant,
          productName: b.productSnapshot.productName,
          variantName: b.productSnapshot.variantName,
          quantitySold: 0,
          revenuePaise: 0,
          orderIds: new Set(),
        });
    }
    return [...map.values()].map((x) => {
      const b = batches.filter(
        (z) =>
          String(z.product) === String(x.productId) &&
          String(z.productVariant) === String(x.variantId),
      );
      const produced = b.reduce((s, v) => s + (v.producedQuantity || 0), 0),
        wasted = b.reduce((s, v) => s + (v.wastageQuantity || 0), 0);
      return {
        productId: x.productId,
        variantId: x.variantId,
        productName: x.productName,
        variantName: x.variantName,
        quantitySold: x.quantitySold,
        orderCount: x.orderIds.size,
        ...(isOwner(user) ? {
          revenuePaise: x.revenuePaise,
          averageSellingPricePaise: x.quantitySold
            ? Math.round(x.revenuePaise / x.quantitySold)
            : null,
        } : {}),
        productionQuantity: produced,
        wastageQuantity: wasted,
        wastageRate: produced
          ? Number(((wasted / produced) * 100).toFixed(2))
          : null,
      };
    });
  }
  async inventory(dates = {}, user) {
    const operational = await inventoryService.getStockPage({
      page: 1,
      limit: 1000,
      lowStockOnly: true,
    });
    const now = new Date(),
      until = new Date(now.getTime() + 30 * 86400000),
      expiringFilter = {
        status: "AVAILABLE",
        remainingQuantity: { $gt: 0 },
        expiryDate: { $gt: now, $lte: until },
      };
    const managers = isManager(user);
    const owner = isOwner(user);
    const [expiringLots, expiringLotCount] = await Promise.all([
      InventoryLot.find(expiringFilter)
        .sort({ expiryDate: 1 })
        .limit(1000)
        .populate("ingredient", "name unit"),
      InventoryLot.countDocuments(expiringFilter),
    ]);
    const result = {
      lowStockIngredients: operational.items,
      lowStockCount: operational.meta.total,
      expiringLots: expiringLots.map((l) =>
        owner
          ? l
          : {
              _id: l._id,
              ingredient: l.ingredient,
              lotNumber: l.lotNumber,
              remainingQuantity: l.remainingQuantity,
              unit: l.unit,
              expiryDate: l.expiryDate,
              status: l.status,
            },
      ),
      expiringLotCount,
    };
    if (managers) {
      const transactionGroups = await InventoryTransaction.aggregate([
        { $match: withDate({}, "createdAt", dates) },
        {
          $group: {
            _id: { type: "$type", direction: "$direction", unit: "$unit" },
            quantity: { $sum: "$quantity" },
            count: { $sum: 1 },
          },
        },
      ]);
      const quantityBy = (test) =>
        transactionGroups
          .filter((g) => test(g._id))
          .reduce((out, g) => {
            out[g._id.unit] = (out[g._id.unit] || 0) + g.quantity;
            return out;
          }, {});
      result.transactionCount = transactionGroups.reduce(
        (s, g) => s + g.count,
        0,
      );
      result.stockAddedByUnit = quantityBy((k) => k.direction === "IN");
      result.stockConsumedByUnit = quantityBy((k) => k.type === "CONSUMPTION");
      result.wastageByUnit = quantityBy((k) => k.type === "WASTAGE");
      let value = 0;
      const valueCursor = InventoryLot.find({
        status: "AVAILABLE",
        remainingQuantity: { $gt: 0 },
        $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
      })
        .select("remainingQuantity unitCost")
        .lean()
        .cursor();
      for await (const lot of valueCursor)
        value = sumSafePaise([
          value,
          multiplyQuantityByRupees(lot.remainingQuantity, lot.unitCost),
        ]);
      if (owner) result.stockValuePaise = value;
    }
    return result;
  }
  async production(dates = {}, user, group = "day") {
    const owner = isOwner(user),
      managers = isManager(user),
      filter =
        user.role === USER_ROLES.PRODUCTION_STAFF
          ? { "assignedWorkers.worker": user._id }
          : {};
    const projection =
      "status plannedQuantity producedQuantity usableQuantity wastageQuantity actualStartTime actualCompletionTime createdAt" +
      (owner
        ? " costing.status costing.totalCostPaise costing.labourCostPaise"
        : "");
    const batches = await ProductionBatch.find(
      withDate(filter, "createdAt", dates),
    ).select(projection);
    const byStatus = {};
    let planned = 0,
      produced = 0,
      usable = 0,
      wasted = 0,
      duration = 0,
      durationCount = 0,
      cost = 0,
      labour = 0;
    const trend = new Map();
    for (const b of batches) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      planned += b.plannedQuantity;
      produced += b.producedQuantity || 0;
      usable += b.usableQuantity || 0;
      wasted += b.wastageQuantity || 0;
      if (b.actualStartTime && b.actualCompletionTime) {
        duration += b.actualCompletionTime - b.actualStartTime;
        durationCount++;
      }
      if (owner && b.costing.status === "FINALIZED") {
        cost = sumSafePaise([cost, b.costing.totalCostPaise]);
        labour = sumSafePaise([labour, b.costing.labourCostPaise]);
      }
      const k = bucket(b.actualCompletionTime || b.createdAt, group);
      trend.set(k, (trend.get(k) || 0) + 1);
    }
    return {
      totalBatches: batches.length,
      byStatus,
      completedBatches: byStatus.COMPLETED || 0,
      packagedBatches: byStatus.PACKAGED || 0,
      qualityCheckBatches: byStatus.QUALITY_CHECK || 0,
      qualityFailedBatches: byStatus.QUALITY_FAILED || 0,
      packagingBatches: byStatus.PACKAGING || 0,
      deliveredBatches: byStatus.DELIVERED || 0,
      cancelledBatches: byStatus.CANCELLED || 0,
      plannedQuantity: planned,
      producedQuantity: produced,
      usableQuantity: usable,
      wastageQuantity: wasted,
      averageDurationMinutes: durationCount
        ? Math.round(duration / durationCount / 60000)
        : null,
      ...(owner
        ? { productionCostPaise: cost, labourCostPaise: labour }
        : {}),
      trend: [...trend]
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => a.period.localeCompare(b.period)),
    };
  }
  async wastage(dates = {}) {
    const rows = await WastageRecord.find(
      withDate({ status: "RECORDED" }, "recordedAt", dates),
    ).select(
      "type reason product productVariant productSnapshot ingredientNameSnapshot quantity unit valuePaise recordedAt",
    );
    const byReason = {},
      byProduct = {},
      byIngredient = {},
      trendMap = new Map(),
      valuePaiseByType = {
        RAW_MATERIAL: 0,
        PACKAGING: 0,
        PRODUCTION_OUTPUT: 0,
      };
    const addQuantity = (target, type, unit, quantity) => {
      target[type] ??= {};
      target[type][unit] = (target[type][unit] || 0) + quantity;
    };
    for (const r of rows) {
      valuePaiseByType[r.type] = sumSafePaise([
        valuePaiseByType[r.type] || 0,
        r.valuePaise || 0,
      ]);
      byReason[r.reason] = (byReason[r.reason] || 0) + 1;
      const p = `${r.productSnapshot?.productName || "Unknown"} (${r.productSnapshot?.variantName || "Unknown variant"})`;
      byProduct[p] ??= { records: 0, quantityByTypeAndUnit: {} };
      byProduct[p].records++;
      addQuantity(
        byProduct[p].quantityByTypeAndUnit,
        r.type,
        r.unit,
        r.quantity,
      );
      if (r.ingredientNameSnapshot) {
        byIngredient[r.ingredientNameSnapshot] ??= {
          records: 0,
          quantityByUnit: {},
        };
        byIngredient[r.ingredientNameSnapshot].records++;
        const u = byIngredient[r.ingredientNameSnapshot].quantityByUnit;
        u[r.unit] = (u[r.unit] || 0) + r.quantity;
      }
      const k = bucket(r.recordedAt, "day");
      const item = trendMap.get(k) || {
        period: k,
        records: 0,
        quantityByTypeAndUnit: {},
      };
      item.records++;
      addQuantity(item.quantityByTypeAndUnit, r.type, r.unit, r.quantity);
      trendMap.set(k, item);
    }
    return {
      totalRecords: rows.length,
      quantityByTypeAndUnit: rows.reduce((out, r) => {
        addQuantity(out, r.type, r.unit, r.quantity);
        return out;
      }, {}),
      valuePaiseByType,
      byReason,
      byProduct,
      byIngredient,
      trend: [...trendMap.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
    };
  }
  async profitability(dates = {}, group = "day") {
    const paid = await this.paidOrders(dates);
    let revenue = 0;
    const trend = new Map();
    for (const o of paid) {
      const value = o.items.reduce((s, i) => s + paise(i.lineTotal), 0);
      revenue = sumSafePaise([revenue, value]);
      const key = bucket(o.createdAt, group),
        item = trend.get(key) || {
          period: key,
          revenuePaise: 0,
          productionCostPaise: 0,
        };
      item.revenuePaise = sumSafePaise([item.revenuePaise, value]);
      trend.set(key, item);
    }
    const batches = await ProductionBatch.find(
      withDate({ "costing.status": "FINALIZED" }, "costing.finalizedAt", dates),
    );
    const totalCost = batches.reduce(
      (s, b) => sumSafePaise([s, b.costing.totalCostPaise]),
      0,
    );
    const sum = (key) =>
      batches.reduce((s, b) => sumSafePaise([s, b.costing[key] || 0]), 0);
    for (const b of batches) {
      const key = bucket(b.costing.finalizedAt, group),
        item = trend.get(key) || {
          period: key,
          revenuePaise: 0,
          productionCostPaise: 0,
        };
      item.productionCostPaise = sumSafePaise([
        item.productionCostPaise,
        b.costing.totalCostPaise,
      ]);
      trend.set(key, item);
    }
    return {
      revenuePaise: revenue,
      productionCostPaise: totalCost,
      ingredientCostPaise: sum("ingredientCostPaise"),
      labourCostPaise: sum("labourCostPaise"),
      packagingCostPaise: sum("packagingCostPaise"),
      otherExpensePaise: sum("otherExpensePaise"),
      wastageCostPaise: sum("wastageCostPaise"),
      profitPaise: revenue - totalCost,
      marginPercentage: revenue
        ? Number((((revenue - totalCost) * 100) / revenue).toFixed(2))
        : null,
      marginStatus: revenue ? "COMPUTABLE" : "UNAVAILABLE",
      finalizedBatchCount: batches.length,
      trend: [...trend.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
    };
  }
  async dashboard(dates, user) {
    const defaultDates =
      dates.from || dates.to
        ? dates
        : { from: new Date(Date.now() - 30 * 86400000), to: new Date() };
    const [sales, orders, inventory, production, wastage, satisfaction, profitability] =
      await Promise.all([
        this.sales(defaultDates, "day"),
        this.orders(defaultDates, "day"),
        this.inventory(defaultDates, user),
        this.production(defaultDates, user, "day"),
        this.wastage(defaultDates),
        this.satisfaction(defaultDates),
        isManager(user)
          ? this.profitability(defaultDates)
          : Promise.resolve(undefined),
      ]);
    return {
      sales,
      orders,
      inventory,
      production,
      wastage,
      satisfaction,
      ...(profitability ? { profitability } : {}),
    };
  }

  async getSalesSummary(dates = {}, filters = {}) {
    const dateFilter = withDate({}, "createdAt", dates);
    const orderQuery = { ...dateFilter };
    if (filters.productId) {
      orderQuery["items.productId"] = filters.productId;
    }
    if (filters.variantId) {
      orderQuery["items.variantId"] = filters.variantId;
    }

    const orders = await Order.find(orderQuery)
      .select("orderNumber items subtotal discount tax deliveryFee total paymentMethod paymentStatus paymentSummary status cancellation createdAt")
      .lean();

    const orderIds = orders.map((o) => o._id);
    const payments = orderIds.length
      ? await Payment.find({ order: { $in: orderIds } }).select("order amount status").lean()
      : [];

    const capturedPaymentOrderIds = new Set(
      payments.filter((p) => p.status === "CAPTURED").map((p) => String(p.order))
    );
    const refundedPayments = payments.filter((p) => ["REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status));
    const refundMap = new Map();
    for (const p of refundedPayments) {
      const orderIdStr = String(p.order);
      refundMap.set(orderIdStr, sumSafePaise([refundMap.get(orderIdStr) || 0, p.amount || 0]));
    }

    let totalOrders = orders.length;
    let paidOrders = 0;
    let pendingOrders = 0;
    let cancelledOrders = 0;
    let grossSalesPaise = 0;
    let discountPaise = 0;
    let refundPaise = 0;
    let pendingPaymentPaise = 0;

    const soldProductVariants = new Map();

    for (const o of orders) {
      const isCancelled = ["CANCELLED", "EXPIRED"].includes(o.status) || o.paymentStatus === "PAYMENT_REJECTED";
      if (isCancelled) {
        cancelledOrders++;
        continue;
      }

      const isPaid = o.paymentStatus === "PAYMENT_CONFIRMED" ||
        o.paymentStatus === "SUCCESS" ||
        o.paymentSummary?.status === "CAPTURED" ||
        capturedPaymentOrderIds.has(String(o._id));

      if (isPaid) {
        paidOrders++;
        let orderItemsTotalPaise = 0;
        for (const line of o.items || []) {
          if (filters.productId && String(line.productId) !== String(filters.productId)) continue;
          if (filters.variantId && String(line.variantId) !== String(filters.variantId)) continue;

          const linePaise = safePaise(line.lineTotal ?? (line.unitPrice * line.quantity));
          orderItemsTotalPaise = sumSafePaise([orderItemsTotalPaise, linePaise]);

          const pvKey = `${line.productId}:${line.variantId}`;
          const currentPv = soldProductVariants.get(pvKey) || {
            productId: line.productId,
            variantId: line.variantId,
            unitsSold: 0,
            grossPaise: 0,
          };
          currentPv.unitsSold += line.quantity;
          currentPv.grossPaise = sumSafePaise([currentPv.grossPaise, linePaise]);
          soldProductVariants.set(pvKey, currentPv);
        }

        grossSalesPaise = sumSafePaise([grossSalesPaise, orderItemsTotalPaise]);
        if (o.discount) {
          discountPaise = sumSafePaise([discountPaise, safePaise(o.discount)]);
        }
        if (refundMap.has(String(o._id))) {
          refundPaise = sumSafePaise([refundPaise, refundMap.get(String(o._id))]);
        } else if (o.paymentStatus === "REFUNDED") {
          refundPaise = sumSafePaise([refundPaise, safePaise(o.total)]);
        }
      } else if (o.status === "PENDING_PAYMENT") {
        pendingOrders++;
        pendingPaymentPaise = sumSafePaise([pendingPaymentPaise, safePaise(o.total)]);
      }
    }

    const netSalesPaise = Math.max(0, grossSalesPaise - discountPaise - refundPaise);

    // COGS & Profitability calculation from finalized batches
    let totalCogsPaise = 0;
    let totalUnitsSold = 0;
    let totalCostedUnits = 0;

    for (const pv of soldProductVariants.values()) {
      totalUnitsSold += pv.unitsSold;
      const batches = await ProductionBatch.find({
        product: pv.productId,
        productVariant: pv.variantId,
        "costing.status": "FINALIZED",
      }).sort({ actualCompletionTime: 1 }).lean();

      let remainingSold = pv.unitsSold;
      let itemCogsPaise = 0;
      for (const batch of batches) {
        if (remainingSold <= 0 || (batch.usableQuantity || 0) <= 0) break;
        const unitsFromBatch = Math.min(batch.usableQuantity, remainingSold);
        const costPerItemPaise = batch.costing.costPerUsableItemPaise != null
          ? batch.costing.costPerUsableItemPaise
          : Math.round(batch.costing.totalCostPaise / batch.usableQuantity);
        itemCogsPaise = sumSafePaise([itemCogsPaise, costPerItemPaise * unitsFromBatch]);
        remainingSold -= unitsFromBatch;
      }

      const costedUnits = pv.unitsSold - remainingSold;
      totalCostedUnits += costedUnits;
      totalCogsPaise = sumSafePaise([totalCogsPaise, itemCogsPaise]);
    }

    let cogsStatus = "UNAVAILABLE";
    let cogsCoveragePercent = 0;
    let grossProfitPaise = null;
    let grossProfit = null;
    let grossMarginPercentage = null;
    let grossMarginStatus = "UNAVAILABLE";

    if (totalUnitsSold > 0) {
      cogsCoveragePercent = Math.round((totalCostedUnits / totalUnitsSold) * 100);
      if (totalCostedUnits === totalUnitsSold) {
        cogsStatus = "COMPUTABLE";
        grossProfitPaise = netSalesPaise - totalCogsPaise;
        grossProfit = safeRupees(grossProfitPaise);
        grossMarginPercentage = netSalesPaise > 0
          ? Number((((netSalesPaise - totalCogsPaise) / netSalesPaise) * 100).toFixed(2))
          : 0;
        grossMarginStatus = "COMPUTABLE";
      } else if (totalCostedUnits > 0) {
        cogsStatus = "PARTIAL";
        grossProfitPaise = netSalesPaise - totalCogsPaise;
        grossProfit = safeRupees(grossProfitPaise);
        grossMarginPercentage = netSalesPaise > 0
          ? Number((((netSalesPaise - totalCogsPaise) / netSalesPaise) * 100).toFixed(2))
          : 0;
        grossMarginStatus = "PARTIAL";
      }
    } else if (netSalesPaise === 0) {
      // Genuine zero profit: when no paid units were sold and recognized sales is zero,
      // COGS is genuinely 0 and Gross Profit is established as 0 (not missing data).
      cogsStatus = "COMPUTABLE";
      cogsCoveragePercent = 100;
      totalCogsPaise = 0;
      grossProfitPaise = 0;
      grossProfit = 0;
      grossMarginPercentage = 0;
      grossMarginStatus = "COMPUTABLE";
    }

    return {
      dateRange: {
        from: dates.from ? new Date(dates.from).toISOString() : null,
        to: dates.to ? new Date(dates.to).toISOString() : null,
      },
      summary: {
        totalOrders,
        paidOrders,
        pendingOrders,
        cancelledOrders,
        grossSalesPaise,
        grossSales: safeRupees(grossSalesPaise),
        discountPaise,
        discount: safeRupees(discountPaise),
        refundPaise,
        refund: safeRupees(refundPaise),
        netSalesPaise,
        netSales: safeRupees(netSalesPaise),
        pendingPaymentPaise,
        pendingPayment: safeRupees(pendingPaymentPaise),
        cogsPaise: cogsStatus !== "UNAVAILABLE" ? totalCogsPaise : null,
        cogs: cogsStatus !== "UNAVAILABLE" ? safeRupees(totalCogsPaise) : null,
        cogsStatus,
        cogsCoveragePercent,
        grossProfitPaise,
        grossProfit,
        grossMarginPercentage,
        grossMarginStatus,
      },
      definitions: {
        totalOrders: "Total distinct orders placed within the selected time window",
        paidOrders: "Orders with confirmed manual UPI or captured payment gateway status (excluding cancellations)",
        grossSales: "Total value of line items (unit price * quantity) before deductions for paid orders",
        netSales: "Recognized sales revenue (Gross Sales - Discounts - Refunds)",
        pendingPayment: "Total value of orders currently awaiting payment submission or manager verification",
        cogs: "Cost of Goods Sold based on finalized production batch costing data",
        grossProfit: "Net Sales minus Cost of Goods Sold (available when batch cost data exists)",
        grossMargin: "Gross Profit as a percentage of Net Sales: (Gross Profit / Net Sales) * 100",
      },
    };
  }

  async getSalesOverTime(dates = {}, requestedGroup = "day") {
    let group = requestedGroup || "day";
    if (dates.from && dates.to && !requestedGroup) {
      const diffMs = new Date(dates.to) - new Date(dates.from);
      if (diffMs <= 2 * 86400000) group = "hour";
    }

    const orders = await Order.find(withDate({}, "createdAt", dates))
      .select("orderNumber items subtotal discount tax deliveryFee total paymentMethod paymentStatus paymentSummary status cancellation createdAt")
      .lean();

    const orderIds = orders.map((o) => o._id);
    const payments = orderIds.length
      ? await Payment.find({ order: { $in: orderIds } }).select("order amount status").lean()
      : [];

    const capturedPaymentOrderIds = new Set(
      payments.filter((p) => p.status === "CAPTURED").map((p) => String(p.order))
    );
    const refundedPayments = payments.filter((p) => ["REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status));
    const refundMap = new Map();
    for (const p of refundedPayments) {
      const orderIdStr = String(p.order);
      refundMap.set(orderIdStr, sumSafePaise([refundMap.get(orderIdStr) || 0, p.amount || 0]));
    }

    const bucketKey = (date) => {
      const d = new Date(date);
      if (group === "hour") {
        return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
      }
      if (group === "month") {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      }
      if (group === "week") {
        const day = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - day);
        return d.toISOString().slice(0, 10);
      }
      return d.toISOString().slice(0, 10);
    };

    const timelineMap = new Map();

    for (const o of orders) {
      const k = bucketKey(o.createdAt);
      const entry = timelineMap.get(k) || {
        period: k,
        totalOrders: 0,
        paidOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
        grossSalesPaise: 0,
        netSalesPaise: 0,
        discountPaise: 0,
        refundPaise: 0,
        pendingPaymentPaise: 0,
      };

      entry.totalOrders++;

      const isCancelled = ["CANCELLED", "EXPIRED"].includes(o.status) || o.paymentStatus === "PAYMENT_REJECTED";
      if (isCancelled) {
        entry.cancelledOrders++;
      } else {
        const isPaid = o.paymentStatus === "PAYMENT_CONFIRMED" ||
          o.paymentStatus === "SUCCESS" ||
          o.paymentSummary?.status === "CAPTURED" ||
          capturedPaymentOrderIds.has(String(o._id));

        if (isPaid) {
          entry.paidOrders++;
          let orderItemsPaise = 0;
          for (const line of o.items || []) {
            orderItemsPaise = sumSafePaise([orderItemsPaise, safePaise(line.lineTotal ?? (line.unitPrice * line.quantity))]);
          }
          entry.grossSalesPaise = sumSafePaise([entry.grossSalesPaise, orderItemsPaise]);
          const dPaise = o.discount ? safePaise(o.discount) : 0;
          entry.discountPaise = sumSafePaise([entry.discountPaise, dPaise]);

          let rPaise = 0;
          if (refundMap.has(String(o._id))) {
            rPaise = refundMap.get(String(o._id));
          } else if (o.paymentStatus === "REFUNDED") {
            rPaise = safePaise(o.total);
          }
          entry.refundPaise = sumSafePaise([entry.refundPaise, rPaise]);
          entry.netSalesPaise = Math.max(0, entry.grossSalesPaise - entry.discountPaise - entry.refundPaise);
        } else if (o.status === "PENDING_PAYMENT") {
          entry.pendingOrders++;
          entry.pendingPaymentPaise = sumSafePaise([entry.pendingPaymentPaise, safePaise(o.total)]);
        }
      }

      timelineMap.set(k, entry);
    }

    const timeline = [...timelineMap.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((item) => ({
        ...item,
        grossSales: safeRupees(item.grossSalesPaise),
        netSales: safeRupees(item.netSalesPaise),
        discount: safeRupees(item.discountPaise),
        refund: safeRupees(item.refundPaise),
        pendingPayment: safeRupees(item.pendingPaymentPaise),
      }));

    return { timeline, group };
  }

  async getTopProducts(dates = {}, limit = 5) {
    const orders = await Order.find(
      withDate({ status: { $nin: ["CANCELLED", "EXPIRED"] } }, "createdAt", dates)
    ).select("orderNumber items paymentStatus paymentSummary status").lean();

    const orderIds = orders.map((o) => o._id);
    const payments = orderIds.length
      ? await Payment.find({ order: { $in: orderIds }, status: "CAPTURED" }).select("order").lean()
      : [];
    const capturedSet = new Set(payments.map((p) => String(p.order)));

    const paidOrders = orders.filter((o) =>
      o.paymentStatus === "PAYMENT_CONFIRMED" ||
      o.paymentStatus === "SUCCESS" ||
      o.paymentSummary?.status === "CAPTURED" ||
      capturedSet.has(String(o._id))
    );

    const productMap = new Map();
    for (const o of paidOrders) {
      for (const line of o.items || []) {
        const key = `${line.productId}:${line.variantId}`;
        const item = productMap.get(key) || {
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName || "Unknown Product",
          variantName: line.variantName || "Standard",
          unitsSold: 0,
          grossSalesPaise: 0,
          orderCountSet: new Set(),
        };
        item.unitsSold += line.quantity;
        item.grossSalesPaise = sumSafePaise([item.grossSalesPaise, safePaise(line.lineTotal ?? (line.unitPrice * line.quantity))]);
        item.orderCountSet.add(String(o._id));
        productMap.set(key, item);
      }
    }

    const all = [...productMap.values()].map((p) => ({
      productId: p.productId,
      variantId: p.variantId,
      productName: p.productName,
      variantName: p.variantName,
      unitsSold: p.unitsSold,
      orderCount: p.orderCountSet.size,
      grossSalesPaise: p.grossSalesPaise,
      grossSales: safeRupees(p.grossSalesPaise),
      netSalesPaise: p.grossSalesPaise,
      netSales: safeRupees(p.grossSalesPaise),
    }));

    const byUnitsSold = [...all].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, limit);
    const byRevenue = [...all].sort((a, b) => b.grossSalesPaise - a.grossSalesPaise).slice(0, limit);

    return { byUnitsSold, byRevenue };
  }

  async getProductPerformance(dates = {}, { page = 1, limit = 20, search = "", sortBy = "netSales", sortOrder = "desc" } = {}) {
    const orders = await Order.find(
      withDate({ status: { $nin: ["CANCELLED", "EXPIRED"] } }, "createdAt", dates)
    ).select("orderNumber items paymentStatus paymentSummary status").lean();

    const orderIds = orders.map((o) => o._id);
    const payments = orderIds.length
      ? await Payment.find({ order: { $in: orderIds }, status: "CAPTURED" }).select("order").lean()
      : [];
    const capturedSet = new Set(payments.map((p) => String(p.order)));

    const paidOrders = orders.filter((o) =>
      o.paymentStatus === "PAYMENT_CONFIRMED" ||
      o.paymentStatus === "SUCCESS" ||
      o.paymentSummary?.status === "CAPTURED" ||
      capturedSet.has(String(o._id))
    );

    const productMap = new Map();
    for (const o of paidOrders) {
      for (const line of o.items || []) {
        const key = `${line.productId}:${line.variantId}`;
        const item = productMap.get(key) || {
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName || "Unknown Product",
          variantName: line.variantName || "Standard",
          unitsSold: 0,
          grossSalesPaise: 0,
          orderCountSet: new Set(),
        };
        item.unitsSold += line.quantity;
        item.grossSalesPaise = sumSafePaise([item.grossSalesPaise, safePaise(line.lineTotal ?? (line.unitPrice * line.quantity))]);
        item.orderCountSet.add(String(o._id));
        productMap.set(key, item);
      }
    }

    const items = [];
    for (const p of productMap.values()) {
      const batches = await ProductionBatch.find({
        product: p.productId,
        productVariant: p.variantId,
        "costing.status": "FINALIZED",
      }).sort({ actualCompletionTime: 1 }).lean();

      let remainingSold = p.unitsSold;
      let cogsPaise = 0;
      for (const batch of batches) {
        if (remainingSold <= 0 || (batch.usableQuantity || 0) <= 0) break;
        const unitsFromBatch = Math.min(batch.usableQuantity, remainingSold);
        const costPerItemPaise = batch.costing.costPerUsableItemPaise != null
          ? batch.costing.costPerUsableItemPaise
          : Math.round(batch.costing.totalCostPaise / batch.usableQuantity);
        cogsPaise = sumSafePaise([cogsPaise, costPerItemPaise * unitsFromBatch]);
        remainingSold -= unitsFromBatch;
      }

      const costedUnits = p.unitsSold - remainingSold;
      let cogsStatus = "UNAVAILABLE";
      let grossProfitPaise = null;
      let grossMarginPercentage = null;

      if (p.unitsSold > 0) {
        if (costedUnits === p.unitsSold) {
          cogsStatus = "COMPUTABLE";
          grossProfitPaise = p.grossSalesPaise - cogsPaise;
          grossMarginPercentage = p.grossSalesPaise > 0
            ? Number((((p.grossSalesPaise - cogsPaise) / p.grossSalesPaise) * 100).toFixed(2))
            : 0;
        } else if (costedUnits > 0) {
          cogsStatus = "PARTIAL";
          grossProfitPaise = p.grossSalesPaise - cogsPaise;
          grossMarginPercentage = p.grossSalesPaise > 0
            ? Number((((p.grossSalesPaise - cogsPaise) / p.grossSalesPaise) * 100).toFixed(2))
            : 0;
        }
      }

      items.push({
        productId: p.productId,
        variantId: p.variantId,
        productName: p.productName,
        variantName: p.variantName,
        unitsSold: p.unitsSold,
        orderCount: p.orderCountSet.size,
        grossSalesPaise: p.grossSalesPaise,
        grossSales: safeRupees(p.grossSalesPaise),
        discounts: 0,
        discountsPaise: 0,
        refunds: 0,
        refundsPaise: 0,
        netSalesPaise: p.grossSalesPaise,
        netSales: safeRupees(p.grossSalesPaise),
        cogsPaise: cogsStatus !== "UNAVAILABLE" ? cogsPaise : null,
        cogs: cogsStatus !== "UNAVAILABLE" ? safeRupees(cogsPaise) : null,
        cogsStatus,
        costedUnits,
        grossProfitPaise,
        grossProfit: grossProfitPaise != null ? safeRupees(grossProfitPaise) : null,
        grossMarginPercentage,
        marginStatus: cogsStatus,
      });
    }

    let filtered = items;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((item) =>
        item.productName.toLowerCase().includes(q) || item.variantName.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") {
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      valA = valA == null ? -Infinity : valA;
      valB = valB == null ? -Infinity : valB;
      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    return {
      products: paginated,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async exportSalesCsv(dates = {}) {
    const summaryData = await this.getSalesSummary(dates);
    const performanceData = await this.getProductPerformance(dates, { page: 1, limit: 10000 });

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return "";
      let str = String(val);
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const s = summaryData.summary;
    const fromStr = dates.from ? new Date(dates.from).toISOString().slice(0, 10) : "All Time";
    const toStr = dates.to ? new Date(dates.to).toISOString().slice(0, 10) : "Now";

    const lines = [];
    lines.push(escapeCsv("Smart Bakery Management - Sales & Profit Analytics Report"));
    lines.push(`${escapeCsv("Date Range:")},${escapeCsv(`${fromStr} to ${toStr}`)}`);
    lines.push(`${escapeCsv("Generated At:")},${escapeCsv(new Date().toISOString())}`);
    lines.push(`${escapeCsv("Currency:")},${escapeCsv("INR (₹)")}`);
    lines.push("");
    lines.push(escapeCsv("EXECUTIVE SUMMARY"));
    lines.push("Metric,Value,Status,Description");
    lines.push(`Total Orders,${escapeCsv(s.totalOrders)},RECORDED,${escapeCsv("Distinct orders placed in the period")}`);
    lines.push(`Paid Orders,${escapeCsv(s.paidOrders)},VERIFIED,${escapeCsv("Orders with confirmed manual UPI or captured payment gateway")}`);
    lines.push(`Pending Orders,${escapeCsv(s.pendingOrders)},PENDING,${escapeCsv("Orders awaiting payment or manager verification")}`);
    lines.push(`Cancelled Orders,${escapeCsv(s.cancelledOrders)},EXCLUDED,${escapeCsv("Cancelled or expired orders excluded from revenue")}`);
    lines.push(`Gross Sales (INR),${escapeCsv(s.grossSales.toFixed(2))},CONFIRMED,${escapeCsv("Total item value before discounts")}`);
    lines.push(`Discounts (INR),${escapeCsv(s.discount.toFixed(2))},DEDUCTED,${escapeCsv("Promotional discounts deducted")}`);
    lines.push(`Refunds (INR),${escapeCsv(s.refund.toFixed(2))},DEDUCTED,${escapeCsv("Refunds issued to customers")}`);
    lines.push(`Net Sales (INR),${escapeCsv(s.netSales.toFixed(2))},RECOGNIZED,${escapeCsv("Recognized revenue (Gross Sales - Discounts - Refunds)")}`);
    lines.push(`Pending Payment Value (INR),${escapeCsv(s.pendingPayment.toFixed(2))},UNCOLLECTED,${escapeCsv("Unverified/pending payments not recognized as revenue")}`);
    lines.push(`Cost of Goods Sold (COGS) (INR),${s.cogs != null ? escapeCsv(s.cogs.toFixed(2)) : "N/A"},${escapeCsv(s.cogsStatus)},${escapeCsv(`Production cost snapshot coverage: ${s.cogsCoveragePercent}%`)}`);
    lines.push(`Gross Profit (INR),${s.grossProfit != null ? escapeCsv(s.grossProfit.toFixed(2)) : "N/A"},${escapeCsv(s.grossMarginStatus)},${escapeCsv("Net Sales minus Cost of Goods Sold")}`);
    lines.push(`Gross Margin (%),${s.grossMarginPercentage != null ? escapeCsv(`${s.grossMarginPercentage.toFixed(2)}%`) : "N/A"},${escapeCsv(s.grossMarginStatus)},${escapeCsv("Gross Profit / Net Sales * 100")}`);
    lines.push("");
    lines.push(escapeCsv("PRODUCT PERFORMANCE BREAKDOWN"));
    lines.push("Product Name,Variant,Units Sold,Orders,Gross Sales (INR),Discounts (INR),Net Sales (INR),COGS (INR),Gross Profit (INR),Gross Margin (%),Cost Status");

    for (const p of performanceData.products) {
      lines.push([
        escapeCsv(p.productName),
        escapeCsv(p.variantName),
        escapeCsv(p.unitsSold),
        escapeCsv(p.orderCount),
        escapeCsv(p.grossSales.toFixed(2)),
        escapeCsv(p.discounts.toFixed(2)),
        escapeCsv(p.netSales.toFixed(2)),
        p.cogs != null ? escapeCsv(p.cogs.toFixed(2)) : "N/A",
        p.grossProfit != null ? escapeCsv(p.grossProfit.toFixed(2)) : "N/A",
        p.grossMarginPercentage != null ? escapeCsv(`${p.grossMarginPercentage.toFixed(2)}%`) : "N/A",
        escapeCsv(p.cogsStatus),
      ].join(","));
    }

    return lines.join("\r\n");
  }
}
export const analyticsService = new AnalyticsService();
export default analyticsService;
