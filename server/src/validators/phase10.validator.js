import { z } from "zod";
import { NOTIFICATION_TYPES } from "../utils/constants.js";
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const dateStart = z.preprocess(
  (v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? `${v}T00:00:00.000Z`
      : v,
  z.coerce.date(),
);
const dateEnd = z.preprocess(
  (v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? `${v}T23:59:59.999Z`
      : v,
  z.coerce.date(),
);
export const paginationQuery = z.object({ page, limit });
export const dateQuery = z
  .object({
    from: dateStart.optional(),
    to: dateEnd.optional(),
    group: z.enum(["day", "week", "month"]).default("day"),
    productId: oid.optional(),
    variantId: oid.optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from must be earlier than or equal to to",
  });
export const feedbackCreate = z
  .object({
    order: oid,
    product: oid,
    variant: oid,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional().default(""),
    criteria: z.array(z.object({ name: z.string().trim().min(1).max(50), rating: z.number().int().min(1).max(5) }).strict()).min(2).max(10).refine((items) => new Set(items.map((item) => item.name.toLowerCase())).size === items.length, "Criteria names must be unique").optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
    photoReference: z.string().trim().max(2048).optional().default(""),
  })
  .strict();
export const feedbackUpdate = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(1000).optional(),
    criteria: z.array(z.object({ name: z.string().trim().min(1).max(50), rating: z.number().int().min(1).max(5) }).strict()).min(2).max(10).refine((items) => new Set(items.map((item) => item.name.toLowerCase())).size === items.length, "Criteria names must be unique").optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    photoReference: z.string().trim().max(2048).optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0);
export const complaintCreate = z
  .object({
    order: oid,
    product: oid.optional(),
    variant: oid.optional(),
    category: z.string().trim().min(2).max(80),
    description: z.string().trim().min(5).max(2000),
  })
  .strict()
  .refine((x) => Boolean(x.product) === Boolean(x.variant), {
    message: "product and variant must be provided together",
  });
export const complaintCustomerUpdate = z
  .object({ description: z.string().trim().min(5).max(2000).optional() })
  .strict()
  .refine((x) => Object.keys(x).length > 0);
export const complaintAdminUpdate = z
  .object({
    status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    resolution: z.string().trim().max(2000).optional(),
    internalNotes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0);
export const idParam = z.object({ id: oid });
export const notificationQuery = paginationQuery.extend({
  type: z.enum(Object.values(NOTIFICATION_TYPES)).optional(),
  unread: z.enum(["true", "false"]).optional(),
});
