import { z } from "zod";

const optionalSlug = z.string().trim().min(1).max(120).optional();
const optionalImageUrl = z.string().trim().max(2000).refine((value) => !value || (/^https:\/\//i.test(value) && z.string().url().safeParse(value).success), "Image URL must be a valid HTTPS URL").optional();
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: optionalSlug,
  description: z.string().trim().max(1000).optional(),
  image: z.string().trim().max(2000).optional(),
  imageUrl: optionalImageUrl,
  sortOrder: z.number().min(0).optional(),
});
export const updateCategorySchema = createCategorySchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const idParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid category ID"),
});
