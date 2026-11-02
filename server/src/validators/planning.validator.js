import { z } from "zod";
import { batchCreateSchema, batchParamsSchema } from "./worker.validator.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must use HH:mm");
const timeSlot = z.object({ startTime: time, endTime: time }).refine(
  ({ startTime, endTime }) => startTime < endTime,
  { path: ["endTime"], message: "End time must be after start time" },
);
const assignedWorkers = z.array(z.object({
  worker: z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID"),
  task: z.string().trim().max(200).optional(),
})).min(1).max(100);

export const planCreateSchema = batchCreateSchema
  .omit({ plannedStartTime: true })
  .extend({
    productionDate: dateOnly,
    timeSlot,
    assignedWorkers,
  });

export const planUpdateSchema = z.object({
  plannedQuantity: z.number().int().positive().max(100000).optional(),
  relatedOrders: z.array(z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID")).max(100).optional(),
  productionDate: dateOnly.optional(),
  timeSlot: timeSlot.optional(),
  assignedWorkers: assignedWorkers.optional(),
  productionNotes: z.string().trim().max(3000).optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one plan field to update");

export const planDateQuerySchema = z.object({ date: dateOnly });
export const planParamsSchema = batchParamsSchema;
