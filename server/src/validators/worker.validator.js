import { z } from "zod";
import { HOLD_REASONS, HOLD_INSTRUCTIONS, HOLD_RESOLUTIONS } from "../utils/constants.js";
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
export const workerCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  phone: z.string().trim().max(30).optional(),
  jobDesignation: z.string().trim().max(80).optional(),
  hourlyLabourRate: z.number().finite("Hourly labour rate must be a finite number").min(0, "Hourly labour rate cannot be negative").max(100000).optional(),
});
export const workerUpdateSchema = z
  .object({
    phone: z.string().trim().max(30).optional(),
    jobDesignation: z.string().trim().max(80).optional(),
    hourlyLabourRate: z.number().finite("Hourly labour rate must be a finite number").min(0, "Hourly labour rate cannot be negative").max(100000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const workerParamsSchema = z.object({ id: objectId });
export const workerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  active: z.enum(["true", "false"]).optional(),
  status: z.string().trim().max(50).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date").optional(),
});
export const batchCreateSchema = z.object({
  product: objectId,
  productVariant: objectId,
  plannedQuantity: z.number().positive().max(100000),
  relatedOrders: z.array(objectId).max(100).default([]),
  batchType: z.enum(["CUSTOMER_ORDER", "PLANNED_PRODUCTION"]).optional(),
  plannedReason: z.string().trim().max(100).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid calendar date").optional(),
  timeSlot: z.union([
    z.string().trim().max(100),
    z.object({
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    }),
  ]).optional(),
  plannedStartTime: z.coerce.date().optional(),
  assignedWorkers: z
    .array(
      z.object({
        worker: objectId,
        task: z.string().trim().max(200).optional(),
      }),
    )
    .max(100)
    .default([]),
  productionNotes: z.string().trim().max(3000).optional(),
  ownerInstructions: z.string().trim().max(3000).optional(),
});
export const orderAssignmentSchema = z
  .object({
    worker: objectId.optional(),
    workers: z.array(objectId).max(20).optional(),
    task: z.string().trim().max(200).optional(),
    ownerInstructions: z.string().trim().max(3000).optional(),
  });
export const batchUpdateSchema = z
  .object({
    plannedStartTime: z.coerce.date().nullable().optional(),
    assignedWorkers: z
      .array(
        z.object({
          worker: objectId,
          task: z.string().trim().max(200).optional(),
        }),
      )
      .max(100)
      .optional(),
    productionNotes: z.string().trim().max(3000).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update",
  );
export const batchParamsSchema = z.object({ id: objectId });
export const batchPlanSchema = z.object({
  batchNumber: z.string().trim().min(1).max(80).optional(),
  product: objectId.optional(),
  plannedQuantity: z.number().int().positive().optional(),
  relatedOrders: z.array(objectId).max(100).optional(),
  assignedWorkers: z.array(objectId).max(100).optional(),
}).default({});
export const batchQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum([
      "PLANNED",
      "ACCEPTED",
      "VERIFIED",
      "IN_PRODUCTION",
      "QUALITY_CHECK",
      "QUALITY_FAILED",
      "PACKAGING",
      "REJECTED",
      "COMPLETED",
      "PACKAGED",
      "DELIVERED",
      "CANCELLED",
    ])
    .optional(),
});
export const completionSchema = z
  .object({
    outputQuantity: z.number().positive("Output quantity must be greater than 0").optional(),
    outputUnit: z.string().trim().min(1, "Output unit is required").max(50).optional(),
    outputRemark: z.string().trim().max(1000).optional(),
    producedQuantity: z.number().nonnegative().optional(),
    usableQuantity: z.number().nonnegative().optional(),
    wastageQuantity: z.number().nonnegative().optional(),
    equipmentRuntimeMinutes: z.number().finite("Equipment runtime minutes must be a finite number").min(0).max(10000).optional(),
    delayReason: z.string().trim().max(1000).optional(),
    actualHours: z.number().finite().min(0).max(10000).optional(),
    productionNotes: z.string().trim().max(3000).optional(),
  })
  .superRefine((v, ctx) => {
    const hasOutput = v.outputQuantity !== undefined && v.outputQuantity !== null;
    const hasProduced = v.producedQuantity !== undefined && v.producedQuantity !== null;
    if (!hasOutput && !hasProduced) {
      ctx.addIssue({
        code: "custom",
        path: ["outputQuantity"],
        message: "Output weight or produced quantity is required and must be greater than 0",
      });
      return;
    }
    if (hasProduced) {
      const usable = v.usableQuantity ?? v.producedQuantity;
      const wastage = v.wastageQuantity ?? 0;
      if (usable > v.producedQuantity) {
        ctx.addIssue({
          code: "custom",
          path: ["usableQuantity"],
          message: "Usable quantity cannot exceed produced quantity",
        });
      }
      if (Math.abs(usable + wastage - v.producedQuantity) > 0.0001) {
        ctx.addIssue({
          code: "custom",
          path: ["wastageQuantity"],
          message: "Produced quantity must equal usable quantity plus wastage",
        });
      }
    }
  });

export const packageItemSchema = z.object({
  packageNumber: z.number().int().positive().optional(),
  quantity: z.number().positive("Package quantity must be greater than 0"),
  unit: z.string().trim().min(1, "Package unit is required").max(50),
  remark: z.string().trim().max(500).optional(),
  orderId: objectId.optional(),
  orderNumber: z.string().trim().optional(),
});

export const packagingSchema = z.object({
  packagedQuantity: z.number().nonnegative().max(100000).optional(),
  packages: z.array(packageItemSchema).optional(),
  packagingRemark: z.string().trim().max(1000).optional(),
  discrepancyReason: z.string().trim().max(1000).optional(),
  packagingMaterialsUsed: z.array(z.object({
    materialName: z.string().trim().min(1).max(100),
    consumptionType: z.enum(["PER_PIECE", "PER_BATCH"]).optional(),
    quantityUsed: z.number().min(0).max(100000),
    costPerUnit: z.number().min(0).max(100000).optional(),
    costPaise: z.number().int().nonnegative().optional(),
  })).optional(),
});
export const rejectionSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
export const batchReassignSchema = z.object({
  newWorkerId: objectId,
  reason: z.string().trim().min(1, "Reassignment reason is required").max(1000),
}).strict();
export const assignmentUpdateSchema = z
  .object({
    workerId: objectId.optional(),
    task: z.string().trim().max(200).optional(),
    actualHours: z.number().finite("Actual hours must be a finite number").min(0, "Actual hours cannot be negative").max(10000, "Actual hours cannot exceed 10000").optional(),
    hourlyRateSnapshot: z.number().finite("Hourly rate snapshot must be a finite number").min(0, "Hourly rate cannot be negative").max(100000).optional(),
    taskStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide task, workerId, actualHours, or hourlyRateSnapshot");

export const holdCreateSchema = z.object({
  reason: z.string().trim().min(1, "Hold reason is required").max(300),
  instruction: z.string().trim().min(1, "Hold instruction is required").max(300),
  ownerNote: z.string().trim().max(2000).optional(),
});

export const holdUpdateInstructionSchema = z.object({
  instruction: z.string().trim().min(1, "Hold instruction is required").max(300),
  ownerNote: z.string().trim().max(2000).optional(),
});

export const holdAcknowledgeSchema = z.object({
  currentStage: z.string().trim().min(1, "Current stage is required").max(100),
  workCompleted: z.string().trim().max(1000).optional().default(""),
  ingredientsConsumed: z.boolean().default(false),
  safeStoppingPointReached: z.boolean().optional().default(false),
  note: z.string().trim().max(1000).optional().default(""),
});

export const holdResolveSchema = z.object({
  resolution: z.string().trim().min(1, "Resolution is required").max(300),
  resolutionNote: z.string().trim().max(2000).optional().default(""),
  cancelOrderId: objectId.optional(),
});
