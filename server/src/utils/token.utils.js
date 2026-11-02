import jwt from "jsonwebtoken";
import crypto from "crypto";
import config from "../config/config.js";

/**
 * Generate short-lived Access Token with minimal payload
 */
export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
    },
    config.jwt.accessTokenSecret,
    {
      algorithm: "HS256",
      expiresIn: config.jwt.accessTokenExpiresIn,
    },
  );
};

/**
 * Generate long-lived Refresh Token
 */
export const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      sub: user._id.toString(),
      jti: crypto.randomBytes(16).toString("hex"),
    },
    config.jwt.refreshTokenSecret,
    {
      algorithm: "HS256",
      expiresIn: config.jwt.refreshTokenExpiresIn,
    },
  );
};

/**
 * Verify Access Token
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, config.jwt.accessTokenSecret, {
    algorithms: ["HS256"],
  });
};

/**
 * Verify Refresh Token
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, config.jwt.refreshTokenSecret, {
    algorithms: ["HS256"],
  });
};

/**
 * Hash token using SHA-256 for secure database storage
 */
export const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Standard cookie configuration for refresh tokens
 */
export const getRefreshTokenCookieOptions = () => {
  const sameSite = config.jwt.cookieSameSite || (config.isProduction ? "none" : "lax");
  return {
    httpOnly: true,
    secure: config.isProduction || sameSite === "none",
    sameSite,
    maxAge: config.jwt.refreshTokenMaxAgeMs,
    path: "/",
  };
};

/**
 * Cookie options for clearing refresh tokens (omits maxAge for Express 5 compatibility)
 */
export const getClearRefreshTokenCookieOptions = () => {
  const sameSite = config.jwt.cookieSameSite || (config.isProduction ? "none" : "lax");
  return {
    httpOnly: true,
    secure: config.isProduction || sameSite === "none",
    sameSite,
    path: "/",
  };
};

export default {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenCookieOptions,
  getClearRefreshTokenCookieOptions,
};
