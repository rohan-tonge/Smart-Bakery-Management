import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const imageUrl = z.string().trim().max(2000).refine((value) => !value || (/^https:\/\//i.test(value) && z.string().url().safeParse(value).success), "Image URL must be a valid HTTPS URL");
const fields = {
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(3000).optional(),
  category: objectId,
  images: z.array(z.string().trim().min(1).max(2000)).max(20).optional(),
  imageUrl: imageUrl.optional(),
  basePrice: z.number().min(0).nullable().optional(),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  preparationTime: z.number().finite("Preparation time must be a finite number").min(0, "Preparation time cannot be negative").optional(),
  productionTime: z.number().finite("Production time must be a finite number").min(0, "Production time cannot be negative").optional(),
  preparationTimePerUnit: z.number().finite("Preparation time per unit must be a finite number").min(0, "Preparation time per unit cannot be negative").optional(),
  totalTimeMinutes: z.number().finite("Total time must be a finite number").min(0, "Total time cannot be negative").optional(),
  totalTime: z.number().finite("Total time must be a finite number").min(0, "Total time cannot be negative").optional(),
  electricityCostPerUnit: z.number().finite("Electricity cost per unit must be a finite number").min(0, "Electricity cost per unit cannot be negative").optional(),
  packagingCostPerUnit: z.number().finite("Packaging cost per unit must be a finite number").min(0, "Packaging cost per unit cannot be negative").optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
};
export const createProductSchema = z.object(fields);
export const updateProductSchema = createProductSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const variantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().positive(),
  unit: z.enum(["g", "kg", "ml", "L", "piece"]),
  price: z.number().min(0),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const updateVariantSchema = variantSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const productParamsSchema = z.object({ productId: objectId });
export const variantParamsSchema = productParamsSchema.extend({
  variantId: objectId,
});
export const productQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(20),
    search: z.string().trim().max(100).optional(),
    category: objectId.optional(),
    available: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    { message: "minPrice cannot exceed maxPrice", path: ["minPrice"] },
  );
