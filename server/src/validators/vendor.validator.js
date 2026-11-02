import { z } from "zod";

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .email()
  .or(z.literal(""))
  .optional();
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+\d() .-]*$/)
  .optional();
const vendorFields = {
  name: z.string().trim().min(1).max(160),
  contactPerson: z.string().trim().max(120).optional(),
  phone,
  email: optionalEmail,
  address: z.string().trim().max(1000).optional(),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
};
export const createVendorSchema = z.object(vendorFields);
export const updateVendorSchema = createVendorSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const vendorParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid vendor ID"),
});
export const vendorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
