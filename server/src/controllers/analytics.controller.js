import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import service from "../services/analytics.service.js";

export default {
  sales: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { sales: await service.sales(req.query, req.query.group) } })),
  orders: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { orders: await service.orders(req.query, req.query.group) } })),
  products: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { products: await service.products(req.query, req.query.productId, req.query.variantId, req.user) } })),
  inventory: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { inventory: await service.inventory(req.query, req.user) } })),
  production: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { production: await service.production(req.query, req.user, req.query.group) } })),
  wastage: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { wastage: await service.wastage(req.query) } })),
  satisfaction: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { satisfaction: await service.satisfaction(req.query, req.query.group) } })),
  profitability: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { profitability: await service.profitability(req.query, req.query.group) } })),
  dashboard: asyncHandler(async (req, res) => ApiResponse.success(res, { data: { dashboard: await service.dashboard(req.query, req.user) } })),
  summary: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await service.getSalesSummary(req.query, req.query) })),
  salesOverTime: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await service.getSalesOverTime(req.query, req.query.group) })),
  topProducts: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await service.getTopProducts(req.query, req.query.limit) })),
  productPerformance: asyncHandler(async (req, res) => ApiResponse.success(res, { data: await service.getProductPerformance(req.query, req.query) })),
  exportReport: asyncHandler(async (req, res) => {
    const csvData = await service.exportSalesCsv(req.query);
    const filename = `sales-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csvData);
  }),
};

