import User from "../models/user.model.js";
import AppError from "../utils/appError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { getPaginationMetadata } from "../utils/pagination.js";
import { USER_ROLES } from "../utils/constants.js";

/**
 * List all users with filtering and pagination
 * GET /api/v1/users
 * Allowed: OWNER, MANAGER
 */
export const getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, search } = req.query;

  const query = {};

  if (role) {
    query.role = role;
  }

  if (search) {
    const searchRegex = new RegExp(search.trim(), "i");
    query.$or = [{ name: searchRegex }, { email: searchRegex }];
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(query),
  ]);

  const meta = getPaginationMetadata(total, page, limit);

  return ApiResponse.success(res, {
    message: "Users retrieved successfully",
    data: { users },
    meta,
  });
});

/**
 * Get user by ID
 * GET /api/v1/users/:id
 * Allowed: OWNER, MANAGER, or self
 */
export const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Authorization: OWNER, MANAGER, OWNER_MANAGER, or self
  const isSelf = req.user._id.toString() === id;
  const isPrivileged =
    req.user.role === USER_ROLES.OWNER ||
    req.user.role === USER_ROLES.MANAGER ||
    req.user.role === USER_ROLES.OWNER_MANAGER;

  if (!isSelf && !isPrivileged) {
    throw AppError.forbidden("You are not authorized to view another user's profile");
  }

  const user = await User.findById(id);
  if (!user) {
    throw AppError.notFound("User not found");
  }

  return ApiResponse.success(res, {
    message: "User fetched successfully",
    data: { user },
  });
});

/**
 * Update user active status
 * PATCH /api/v1/users/:id/status
 * Allowed: OWNER, MANAGER
 */
export const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  // Prevent user from deactivating themselves
  if (req.user._id.toString() === id && isActive === false) {
    throw AppError.badRequest("You cannot deactivate your own account");
  }

  const targetUser = await User.findById(id);
  if (!targetUser) {
    throw AppError.notFound("User not found");
  }

  const isOwner = req.user.role === USER_ROLES.OWNER || req.user.role === USER_ROLES.OWNER_MANAGER;
  const isTargetOwner = targetUser.role === USER_ROLES.OWNER || targetUser.role === USER_ROLES.OWNER_MANAGER;

  // Non-owner cannot deactivate an OWNER / OWNER_MANAGER
  if (isTargetOwner && !isOwner) {
    throw AppError.forbidden("Only an OWNER can modify another OWNER's status");
  }

  if (isTargetOwner && !isActive) {
    const activeOwnerCount = await User.countDocuments({
      role: { $in: [USER_ROLES.OWNER, USER_ROLES.OWNER_MANAGER] },
      isActive: true,
    });
    if (activeOwnerCount <= 1) {
      throw AppError.badRequest("Cannot deactivate the last remaining active OWNER");
    }
  }

  targetUser.isActive = isActive;
  if (!isActive) {
    // Invalidate refresh tokens when user is deactivated
    targetUser.refreshTokenHash = null;
  }
  await targetUser.save();

  return ApiResponse.success(res, {
    message: `User account has been ${isActive ? "activated" : "deactivated"} successfully`,
    data: { user: targetUser },
  });
});

/**
 * Update user role
 * PATCH /api/v1/users/:id/role
 * Allowed: OWNER only
 */
export const updateUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const targetUser = await User.findById(id);
  if (!targetUser) {
    throw AppError.notFound("User not found");
  }

  const isTargetOwner = targetUser.role === USER_ROLES.OWNER || targetUser.role === USER_ROLES.OWNER_MANAGER;
  const isNewRoleOwner = role === USER_ROLES.OWNER || role === USER_ROLES.OWNER_MANAGER;

  // If changing self from OWNER/OWNER_MANAGER to another role, verify there is at least one other active OWNER
  if (isTargetOwner && !isNewRoleOwner) {
    const activeOwnerCount = await User.countDocuments({
      role: { $in: [USER_ROLES.OWNER, USER_ROLES.OWNER_MANAGER] },
      isActive: true,
      _id: { $ne: targetUser._id },
    });

    if (targetUser.isActive && activeOwnerCount === 0) {
      throw AppError.badRequest(
        "Cannot demote the last remaining active OWNER. Please assign another active OWNER first."
      );
    }
  }

  targetUser.role = role;
  await targetUser.save();

  return ApiResponse.success(res, {
    message: `User role updated to ${role} successfully`,
    data: { user: targetUser },
  });
});

export default {
  getUsers,
  getUserById,
  updateUserStatus,
  updateUserRole,
};
