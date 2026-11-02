import { z } from "zod";

const oid = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ObjectId format");

const dateStart = z.preprocess((v) => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return `${v}T00:00:00.000Z`;
  }
  return v;
}, z.coerce.date().refine((d) => !isNaN(d.getTime()), "Invalid start date format"));

const dateEnd = z.preprocess((v) => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return `${v}T23:59:59.999Z`;
  }
  return v;
}, z.coerce.date().refine((d) => !isNaN(d.getTime()), "Invalid end date format"));

export const analyticsSummaryQuerySchema = z
  .object({
    from: dateStart.optional(),
    to: dateEnd.optional(),
    preset: z.string().optional(),
    productId: oid.optional(),
    variantId: oid.optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from date must be earlier than or equal to to date",
    path: ["from"],
  });

export const salesOverTimeQuerySchema = z
  .object({
    from: dateStart.optional(),
    to: dateEnd.optional(),
    preset: z.string().optional(),
    group: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from date must be earlier than or equal to to date",
    path: ["from"],
  });

export const topProductsQuerySchema = z
  .object({
    from: dateStart.optional(),
    to: dateEnd.optional(),
    preset: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(5),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from date must be earlier than or equal to to date",
    path: ["from"],
  });

export const productPerformanceQuerySchema = z
  .object({
    from: dateStart.optional(),
    to: dateEnd.optional(),
    preset: z.string().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    search: z.string().trim().max(100).optional().default(""),
    sortBy: z.enum(["unitsSold", "orderCount", "grossSales", "netSales", "grossProfit", "grossMargin", "productName"]).optional().default("netSales"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from date must be earlier than or equal to to date",
    path: ["from"],
  });

export const analyticsExportQuerySchema = z
  .object({
    from: dateStart.optional(),
    to: dateEnd.optional(),
    preset: z.string().optional(),
    format: z.enum(["csv"]).optional().default("csv"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from date must be earlier than or equal to to date",
    path: ["from"],
  });
