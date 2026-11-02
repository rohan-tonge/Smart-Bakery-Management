import { z } from "zod";
import { USER_ROLES } from "../utils/constants.js";

export const updateRoleSchema = z.object({
  role: z.enum(
    [
      USER_ROLES.CUSTOMER,
      USER_ROLES.OWNER_MANAGER,
      USER_ROLES.PRODUCTION_STAFF,
      "OWNER",
      "MANAGER",
    ],
    {
      required_error: "Role is required",
      invalid_type_error: "Invalid role specified",
    },
  ),
});

export const updateStatusSchema = z.object({
  isActive: z.boolean({
    required_error: "isActive boolean is required",
    invalid_type_error: "isActive must be a boolean",
  }),
});

export const userQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  role: z
    .enum([
      USER_ROLES.CUSTOMER,
      USER_ROLES.OWNER_MANAGER,
      USER_ROLES.PRODUCTION_STAFF,
      "OWNER",
      "MANAGER",
    ])
    .optional(),
  search: z.string().optional(),
});

export default {
  updateRoleSchema,
  updateStatusSchema,
  userQuerySchema,
};
