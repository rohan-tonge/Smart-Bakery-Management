import { z } from "zod";
import { CUSTOMER_ORDER_STATUSES, ORDER_TYPES } from "../utils/constants.js";
import { isDateNextDayOrLater } from "../utils/date.utils.js";
const oid = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const item = z.object({
  productId: oid,
  variantId: oid,
  quantity: z.number().int().min(1).max(100),
  specialInstructions: z.string().trim().max(500).optional(),
  packInstructions: z.string().trim().max(500).optional(),
});
const address = z
  .object({
    addressLine1: z.string().trim().min(1, "Street address is required").max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, "City is required").max(100),
    state: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().min(1, "Postal code is required").max(20),
  })
  .strict();
export const feasibilitySchema = z
  .object({ items: z.array(item).min(1).max(50) })
  .strict();
export const checkoutSchema = z
  .object({
    orderType: z.enum(Object.values(ORDER_TYPES)),
    paymentMethod: z.enum(["MANUAL_UPI", "COD", "PAY_ON_DELIVERY"]).default("MANUAL_UPI"),
    deliveryDate: z
      .string({ required_error: "Please select a delivery/pickup date" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Please select a valid delivery/pickup date (YYYY-MM-DD)")
      .refine(isDateNextDayOrLater, {
        message: "Orders must be scheduled at least one day in advance. Select tomorrow or a later date.",
      }),
    deliveryTimeSlot: z.string().trim().max(100).optional(),
    deliveryAddress: address.optional(),
    contactName: z
      .string({ required_error: "Customer name is required" })
      .trim()
      .min(1, "Customer name is required")
      .max(120),
    contactPhone: z
      .string({ required_error: "Phone number is required" })
      .trim()
      .refine(
        (val) => {
          const digits = (val || "").replace(/\D/g, "");
          return digits.length >= 10 && digits.length <= 15;
        },
        { message: "Please enter a valid phone number (at least 10 digits)" }
      ),
    contactEmail: z.string().email().max(254).optional().or(z.literal("")),
    specialInstructions: z.string().trim().max(1000).optional(),
    packInstructions: z.string().trim().max(500).optional(),
    guestId: z.string().trim().optional(),
    items: z.array(item).min(1).max(50).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.orderType === "DELIVERY") {
      if (
        !v.deliveryAddress ||
        !v.deliveryAddress.addressLine1?.trim() ||
        !v.deliveryAddress.city?.trim() ||
        !v.deliveryAddress.postalCode?.trim()
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["deliveryAddress"],
          message: "Complete delivery address (street address, city, pincode) is required for delivery",
        });
      }
    }
    if (v.orderType === "PICKUP" && v.deliveryAddress) {
      ctx.addIssue({
        code: "custom",
        path: ["deliveryAddress"],
        message: "Delivery address is not allowed for pickup orders",
      });
    }
  });

export const trackOrderSchema = z
  .object({
    orderNumber: z.string().trim().min(1, "Order number is required"),
    phone: z.string().trim().optional(),
    token: z.string().trim().optional(),
  });

export const deliverySlotsSchema = z
  .object({
    orderType: z.enum(Object.values(ORDER_TYPES)).default("DELIVERY"),
    items: z.array(item).optional(),
    guestId: z.string().trim().optional(),
  });

export const markPaidSchema = z
  .object({
    screenshot: z.string().min(1, "Payment screenshot is required").optional(),
    mimeType: z.string().regex(/^image\/(jpeg|jpg|png|webp)$/i, "Supported formats: PNG, JPG, WEBP").optional(),
    fileName: z.string().trim().max(255).optional(),
    paymentReference: z.string().trim().optional(),
    transactionReference: z.string().trim().optional(),
    amount: z.coerce.number().finite().positive(),
    token: z.string().trim().optional(),
    trackingToken: z.string().trim().optional(),
    isReturningCustomer: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => {
      if (body.isReturningCustomer) {
        return true;
      }
      return Boolean(body.screenshot || body.paymentReference || body.transactionReference);
    },
    {
      message: "A payment screenshot upload is required for first-time customers",
      path: ["screenshot"],
    }
  );

export const confirmPaymentSchema = z
  .object({
    note: z.string().trim().max(200).optional(),
  })
  .strict()
  .optional();

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(Object.values(CUSTOMER_ORDER_STATUSES)).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  orderNumber: z.string().trim().max(30).optional(),
  customer: oid.optional(),
  search: z.string().trim().max(100).optional(),
});
export const idSchema = z.object({ id: oid });
export const statusSchema = z
  .object({ status: z.enum(Object.values(CUSTOMER_ORDER_STATUSES)) })
  .strict();
export const cancelSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export const cartAddSchema = z
  .object({
    productId: oid,
    variantId: oid,
    quantity: z.number().int().min(1).max(100),
    specialInstructions: z.string().trim().max(500).optional(),
  })
  .strict();
export const cartUpdateSchema = z
  .object({
    quantity: z.number().int().min(1).max(100).optional(),
    specialInstructions: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0);
export const cartItemSchema = z.object({ itemId: oid });
export const finishedStockSchema = z
  .object({
    productId: oid,
    variantId: oid,
    onHandQuantity: z.number().int().min(0),
  })
  .strict();
