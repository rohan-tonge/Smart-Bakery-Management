import { z } from "zod";
import { UNITS, WASTAGE_REASONS, WASTAGE_TYPES } from "../utils/constants.js";
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const money = z.number().finite().min(0).max(100000000);
export const idParamsSchema = z.object({ id: objectId });
export const variantParamsSchema = z.object({ id: objectId });
export const wastageCreateSchema = z
  .object({
    productionBatch: objectId,
    type: z.enum(Object.values(WASTAGE_TYPES)),
    reason: z.enum(Object.values(WASTAGE_REASONS)),
    quantity: z.number().finite().positive().max(100000000),
    unit: z.enum(Object.values(UNITS)),
    ingredient: objectId.optional(),
    inventoryLot: objectId.optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.type === "RAW_MATERIAL" &&
      (!value.ingredient || !value.inventoryLot || !value.idempotencyKey)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Raw-material wastage requires ingredient, inventoryLot, and idempotencyKey",
      });
    if (value.type === "PACKAGING" && !value.idempotencyKey)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Packaging wastage requires an idempotencyKey",
      });
  });
export const wastageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(Object.values(WASTAGE_TYPES)).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const finalizeCostSchema = z.object({
  packagingCost: money.default(0),
  expenses: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(120),
        amount: money,
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .max(50)
    .default([]),
});
export const estimateSchema = z.object({
  product: objectId,
  productVariant: objectId,
  plannedQuantity: z.number().int().positive().max(100000),
  packagingCost: money.default(0),
  labour: z
    .array(
      z.object({
        worker: objectId,
        hours: z.number().finite().min(0).max(10000),
      }),
    )
    .max(100)
    .optional(),
});
export const priceImpactSchema = estimateSchema.extend({
  changes: z
    .array(
      z.object({
        ingredient: objectId,
        increasePercent: z.number().finite().min(-100).max(10000),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.ingredient)).size === items.length,
      "Ingredient price changes must be unique",
    ),
});
export const costSummaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
