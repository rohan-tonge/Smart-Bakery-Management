import { z } from "zod";
import { UNITS } from "../utils/constants.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const purchaseItemSchema = z.object({
  ingredient: objectId,
  quantity: z.number().finite().positive(),
  unit: z.enum(Object.values(UNITS)),
  unitPrice: z.number().finite().min(0),
  lotNumber: z.string().trim().min(1).max(100),
  expiryDate: z.coerce.date().optional().nullable(),
});

export const createPurchaseSchema = z.object({
  vendor: objectId,
  purchaseDate: z.coerce.date(),
  invoiceNumber: z.string().trim().max(100).optional(),
  items: z.array(purchaseItemSchema).min(1).max(500),
  tax: z.number().finite().min(0).default(0),
  notes: z.string().trim().max(2000).optional(),
});
export const purchaseParamsSchema = z.object({ id: objectId });
export const purchaseQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    vendor: objectId.optional(),
    ingredient: objectId.optional(),
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
