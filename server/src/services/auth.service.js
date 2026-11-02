import User from "../models/user.model.js";
import AppError from "../utils/appError.js";
import { USER_ROLES } from "../utils/constants.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../utils/token.utils.js";

class AuthService {
  /**
   * Register a new customer
   * Public registration is strictly restricted to CUSTOMER role
   */
  async register({ name, email, password, phone }) {
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw AppError.conflict("User with this email already exists");
    }

    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      password,
      phone: phone ? phone.trim() : "",
      role: USER_ROLES.CUSTOMER, // Always default to CUSTOMER for public register
    });

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save hashed refresh token
    user.refreshTokenHash = hashToken(refreshToken);
    await user.save();

    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Authenticate user with credentials
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password +refreshTokenHash",
    );

    if (!user) {
      throw AppError.unauthorized("Invalid email or password");
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw AppError.unauthorized("Invalid email or password");
    }

    if (!user.isActive) {
      throw AppError.unauthorized(
        "Your account has been deactivated. Please contact support.",
      );
    }

    // Generate new tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Update refresh token hash (rotation)
    user.refreshTokenHash = hashToken(refreshToken);
    await user.save();

    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Rotate tokens using valid refresh token from cookie
   */
  async refreshToken(incomingToken) {
    if (!incomingToken) {
      throw AppError.unauthorized("Refresh token is required");
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(incomingToken);
    } catch (err) {
      throw AppError.unauthorized("Invalid or expired refresh token");
    }

    const user = await User.findById(decoded.sub).select(
      "+refreshTokenHash +previousRefreshTokenHash +previousRefreshTokenExpiresAt",
    );

    if (!user) {
      throw AppError.unauthorized(
        "User belonging to this token no longer exists",
      );
    }

    if (!user.isActive) {
      throw AppError.unauthorized("Account has been deactivated");
    }

    // Check if token matches stored hash
    const incomingTokenHash = hashToken(incomingToken);

    // Standard rotation path: token matches active refreshTokenHash
    if (user.refreshTokenHash === incomingTokenHash) {
      const newAccessToken = generateAccessToken(user);
      const newRefreshToken = generateRefreshToken(user);

      const rotated = await User.findOneAndUpdate(
        { _id: user._id, isActive: true, refreshTokenHash: incomingTokenHash },
        {
          $set: {
            refreshTokenHash: hashToken(newRefreshToken),
            previousRefreshTokenHash: incomingTokenHash,
            previousRefreshTokenExpiresAt: new Date(Date.now() + 15000), // 15-second grace period for concurrent requests
          },
        },
        { new: true },
      );

      if (rotated) {
        return {
          user: rotated,
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        };
      }
    }

    // Grace period path: token matches previousRefreshTokenHash within the 15-second window
    if (
      user.previousRefreshTokenHash === incomingTokenHash &&
      user.previousRefreshTokenExpiresAt &&
      new Date() <= user.previousRefreshTokenExpiresAt
    ) {
      const concurrentAccessToken = generateAccessToken(user);
      return {
        user,
        accessToken: concurrentAccessToken,
        refreshToken: incomingToken, // Return same valid token during grace window
      };
    }

    throw AppError.unauthorized(
      "Refresh token has been revoked or already used",
    );
  }

  /**
   * Logout user by invalidating refresh token
   */
  async logout(userId, refreshToken) {
    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshTokenHash: null });
      return true;
    }
    if (refreshToken) {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        if (decoded?.sub) {
          await User.findByIdAndUpdate(decoded.sub, { refreshTokenHash: null });
        }
      } catch (err) {
        // Token was invalid or expired, session is effectively closed
      }
    }
    return true;
  }

  /**
   * Fetch current user profile
   */
  async getMe(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw AppError.notFound("User not found");
    }
    return user;
  }

  /**
   * Change user password and invalidate refresh token sessions
   */
  async changePassword({ userId, currentPassword, newPassword }) {
    const user = await User.findById(userId).select(
      "+password +refreshTokenHash",
    );

    if (!user) {
      throw AppError.notFound("User not found");
    }

    const isCurrentPasswordCorrect =
      await user.comparePassword(currentPassword);
    if (!isCurrentPasswordCorrect) {
      throw AppError.badRequest("Current password is incorrect");
    }

    user.password = newPassword;
    user.refreshTokenHash = null; // Invalidate current refresh token sessions
    await user.save();

    return true;
  }
}

export const authService = new AuthService();
export default authService;
