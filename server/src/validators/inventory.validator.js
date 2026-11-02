import { z } from "zod";
import { INVENTORY_TRANSACTION_TYPES, UNITS } from "../utils/constants.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
export const adjustmentSchema = z.object({
  ingredientId: objectId,
  quantity: z.number().finite().positive(),
  unit: z.enum(Object.values(UNITS)),
  type: z.enum(["ADD", "REMOVE"]),
  reason: z.string().trim().min(1).max(500),
  unitCost: z.number().finite().min(0).optional(),
  expiryDate: z.coerce.date().optional(),
  lotNumber: z.string().trim().max(120).optional(),
});
export const ingredientInventoryParamsSchema = z.object({
  ingredientId: objectId,
});
export const inventoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});
export const expiringQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  days: z.coerce.number().int().min(0).max(365).default(7),
});
export const transactionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(20),
    ingredient: objectId.optional(),
    type: z.enum(Object.values(INVENTORY_TRANSACTION_TYPES)).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      value.from <= value.to,
    {
      message: "from cannot be later than to",
      path: ["from"],
    },
  );
