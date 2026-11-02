import { Router } from "express";
import c from "../controllers/analytics.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { dateQuery } from "../validators/phase10.validator.js";
import {
  analyticsSummaryQuerySchema,
  salesOverTimeQuerySchema,
  topProductsQuerySchema,
  productPerformanceQuerySchema,
  analyticsExportQuerySchema,
} from "../validators/analytics.validator.js";
import { USER_ROLES as R } from "../utils/constants.js";
const r = Router();
r.use(authenticateUser);
r.get(
  "/sales",
  authorizeRoles(R.OWNER),
  validateRequest({ query: dateQuery }),
  c.sales,
);
r.get(
  "/orders",
  authorizeRoles(R.OWNER, R.MANAGER),
  validateRequest({ query: dateQuery }),
  c.orders,
);
r.get(
  "/products",
  authorizeRoles(R.OWNER, R.MANAGER),
  validateRequest({ query: dateQuery }),
  c.products,
);
r.get(
  "/inventory",
  authorizeRoles(R.OWNER, R.MANAGER, R.PRODUCTION_STAFF),
  validateRequest({ query: dateQuery }),
  c.inventory,
);
r.get(
  "/production",
  authorizeRoles(R.OWNER, R.MANAGER, R.PRODUCTION_STAFF),
  validateRequest({ query: dateQuery }),
  c.production,
);
r.get(
  "/wastage",
  authorizeRoles(R.OWNER),
  validateRequest({ query: dateQuery }),
  c.wastage,
);
r.get(
  "/satisfaction",
  authorizeRoles(R.OWNER, R.MANAGER),
  validateRequest({ query: dateQuery }),
  c.satisfaction,
);
r.get(
  "/profitability",
  authorizeRoles(R.OWNER),
  validateRequest({ query: dateQuery }),
  c.profitability,
);
r.get(
  "/dashboard",
  authorizeRoles(R.OWNER),
  validateRequest({ query: dateQuery }),
  c.dashboard,
);

// Dedicated Sales & Profit Analytics routes
r.get(
  "/summary",
  authorizeRoles(R.OWNER_MANAGER, R.OWNER, R.MANAGER),
  validateRequest({ query: analyticsSummaryQuerySchema }),
  c.summary,
);
r.get(
  "/sales-over-time",
  authorizeRoles(R.OWNER_MANAGER, R.OWNER, R.MANAGER),
  validateRequest({ query: salesOverTimeQuerySchema }),
  c.salesOverTime,
);
r.get(
  "/top-products",
  authorizeRoles(R.OWNER_MANAGER, R.OWNER, R.MANAGER),
  validateRequest({ query: topProductsQuerySchema }),
  c.topProducts,
);
r.get(
  "/product-performance",
  authorizeRoles(R.OWNER_MANAGER, R.OWNER, R.MANAGER),
  validateRequest({ query: productPerformanceQuerySchema }),
  c.productPerformance,
);
r.get(
  "/export",
  authorizeRoles(R.OWNER_MANAGER, R.OWNER, R.MANAGER),
  validateRequest({ query: analyticsExportQuerySchema }),
  c.exportReport,
);

export default r;

