import { z } from "zod";
import { UNITS } from "../utils/constants.js";

const ingredientFields = {
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(1000).optional(),
  unit: z.enum(Object.values(UNITS)),
  minimumStock: z.number().min(0).optional(),
  reorderLevel: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  openingStock: z.number().min(0).optional(),
  openingStockUnit: z.enum(Object.values(UNITS)).optional(),
  openingStockCost: z.number().min(0).optional(),
  openingStockExpiryDate: z.coerce.date().optional(),
  openingStockLotNumber: z.string().trim().max(120).optional(),
};

export const createIngredientSchema = z.object(ingredientFields);
export const updateIngredientSchema = createIngredientSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const ingredientParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid ingredient ID"),
});
export const ingredientQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(100).optional(),
  unit: z.enum(Object.values(UNITS)).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
