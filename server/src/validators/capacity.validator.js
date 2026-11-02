import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm time");
const minutes = z.number().int().min(1).max(1440);

export const capacityConfigSchema = z.object({
  workingHours: z.object({ open: time, close: time }).strict().refine(
    ({ open, close }) => open < close,
    { path: ["close"], message: "Closing time must be after opening time" },
  ),
  slotMinutes: z.number().int().min(15).max(1440),
  minutesPerStaffPerDay: minutes,
  ovens: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    minutesPerDay: minutes,
  }).strict()).min(1).max(50).refine(
    (ovens) => new Set(ovens.map((oven) => oven.name.toLowerCase())).size === ovens.length,
    "Oven names must be unique",
  ),
}).strict().superRefine((value, context) => {
  const workdayMinutes = Number(value.workingHours.close.slice(0, 2)) * 60 + Number(value.workingHours.close.slice(3))
    - Number(value.workingHours.open.slice(0, 2)) * 60 - Number(value.workingHours.open.slice(3));
  if (value.slotMinutes > workdayMinutes) context.addIssue({ code: "custom", path: ["slotMinutes"], message: "Slot length cannot exceed working hours" });
  if (value.minutesPerStaffPerDay > workdayMinutes) context.addIssue({ code: "custom", path: ["minutesPerStaffPerDay"], message: "Staff minutes cannot exceed working hours" });
  value.ovens.forEach((oven, index) => {
    if (oven.minutesPerDay > workdayMinutes) context.addIssue({ code: "custom", path: ["ovens", index, "minutesPerDay"], message: "Oven minutes cannot exceed working hours" });
  });
});
