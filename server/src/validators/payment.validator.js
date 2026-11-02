import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
export const createPaymentSchema = z.object({ orderId: objectId }).strict();
export const verifyPaymentSchema = z
  .object({
    razorpay_order_id: z.string().trim().min(5).max(100),
    razorpay_payment_id: z.string().trim().min(5).max(100),
    razorpay_signature: z
      .string()
      .regex(/^[a-f\d]{64}$/i, "Invalid Razorpay signature"),
  })
  .strict();
export const paymentIdSchema = z.object({ id: objectId });
