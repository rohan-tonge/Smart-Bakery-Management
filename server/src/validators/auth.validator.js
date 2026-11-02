import { z } from "zod";

export const registerSchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(60, "Name cannot exceed 60 characters"),
  email: z
    .string({ required_error: "Email is required" })
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address")
    .max(254, "Email cannot exceed 254 characters"),
  password: z
    .string({ required_error: "Password is required" })
    .min(6, "Password must be at least 6 characters long")
    .max(128, "Password cannot exceed 128 characters"),
  phone: z.string().trim().max(30).optional().default(""),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address")
    .max(254, "Email cannot exceed 254 characters"),
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password cannot be empty")
    .max(128, "Password cannot exceed 128 characters"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: "Current password is required" })
      .min(1, "Current password cannot be empty")
      .max(128, "Password cannot exceed 128 characters"),
    newPassword: z
      .string({ required_error: "New password is required" })
      .min(6, "New password must be at least 6 characters long")
      .max(128, "Password cannot exceed 128 characters"),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

export default {
  registerSchema,
  loginSchema,
  changePasswordSchema,
};
