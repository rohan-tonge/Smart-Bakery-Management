import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");

export const requisitionItemSchema = z.object({
  ingredient: objectId.optional(),
  ingredientId: objectId.optional(),
  name: z.string().trim().max(100).optional(),
  requestedQuantity: z.number().positive(),
  approvedQuantity: z.number().nonnegative().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  adjustmentReason: z.string().trim().max(500).optional(),
});

export const requisitionCreateSchema = z.object({
  items: z.array(requisitionItemSchema).optional(),
  notes: z.string().trim().max(1000).optional(),
  adjustmentReason: z.string().trim().max(500).optional(),
});

export const requisitionApproveSchema = z.object({
  items: z.array(requisitionItemSchema).optional(),
  notes: z.string().trim().max(1000).optional(),
  adjustmentReason: z.string().trim().max(500).optional(),
});

export const requisitionRejectSchema = z.object({
  reason: z.string().trim().min(2, "Provide a reason for rejection").max(1000),
});

export const requisitionParamsSchema = z.object({
  id: objectId,
});

export const batchRequisitionParamsSchema = z.object({
  id: objectId,
});

export const requisitionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ISSUED"]).optional(),
  batchId: objectId.optional(),
});
