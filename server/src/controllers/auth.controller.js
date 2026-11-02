import authService from "../services/auth.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  getRefreshTokenCookieOptions,
  getClearRefreshTokenCookieOptions,
  verifyAccessToken,
} from "../utils/token.utils.js";

/**
 * Register a new customer
 * POST /api/v1/auth/register
 */
export const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register(req.body);

  // Set secure refresh token cookie
  res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

  return ApiResponse.created(res, {
    message: "Registration successful",
    data: {
      user,
      accessToken,
    },
  });
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body);

  // Set secure refresh token cookie
  res.cookie("refreshToken", refreshToken, getRefreshTokenCookieOptions());

  return ApiResponse.success(res, {
    message: "Login successful",
    data: {
      user,
      accessToken,
    },
  });
});

/**
 * Rotate access and refresh tokens
 * POST /api/v1/auth/refresh
 */
export const refreshToken = asyncHandler(async (req, res) => {
  const incomingToken = req.cookies?.refreshToken;
  const { user, accessToken, refreshToken: newRefreshToken } =
    await authService.refreshToken(incomingToken);

  // Set rotated refresh token cookie
  res.cookie("refreshToken", newRefreshToken, getRefreshTokenCookieOptions());

  return ApiResponse.success(res, {
    message: "Token refreshed successfully",
    data: {
      user,
      accessToken,
    },
  });
});

/**
 * Logout current user
 * POST /api/v1/auth/logout
 */
export const logout = asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]?.trim()
    : null;

  let userId = req.user?._id;

  if (!userId && token) {
    try {
      const decoded = verifyAccessToken(token);
      userId = decoded?.sub;
    } catch {
      // ignore
    }
  }

  const incomingRefreshToken = req.cookies?.refreshToken;
  await authService.logout(userId, incomingRefreshToken);

  // Clear refresh token cookie with matching options
  res.clearCookie("refreshToken", getClearRefreshTokenCookieOptions());

  return ApiResponse.success(res, {
    message: "Logged out successfully",
  });
});

/**
 * Get current authenticated user profile
 * GET /api/v1/auth/me
 */
export const getMe = asyncHandler(async (req, res) => {
  return ApiResponse.success(res, {
    message: "Profile retrieved successfully",
    data: {
      user: req.user,
    },
  });
});

/**
 * Change user password
 * PATCH /api/v1/auth/change-password
 */
export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({
    userId: req.user._id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });

  // Clear cookie since password change invalidates existing sessions
  res.clearCookie("refreshToken", getClearRefreshTokenCookieOptions());

  return ApiResponse.success(res, {
    message: "Password changed successfully. Please log in again with your new password.",
  });
});

export default {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword,
};
