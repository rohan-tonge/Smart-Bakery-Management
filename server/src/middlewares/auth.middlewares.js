import { verifyAccessToken } from "../utils/token.utils.js";
import User from "../models/user.model.js";
import AppError from "../utils/appError.js";

/**
 * Middleware to authenticate requests via Bearer access token
 */
export const authenticateUser = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      return next(
        AppError.unauthorized("Authentication required. Please provide a valid Bearer token.")
      );
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return next(AppError.unauthorized("Access token has expired. Please refresh your session."));
      }
      return next(AppError.unauthorized("Invalid access token."));
    }

    if (!decoded || !decoded.sub) {
      return next(AppError.unauthorized("Malformed access token payload."));
    }

    const user = await User.findById(decoded.sub);

    if (!user) {
      return next(AppError.unauthorized("User account belonging to this token no longer exists."));
    }

    if (!user.isActive) {
      return next(AppError.unauthorized("Your account has been deactivated. Please contact support."));
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication: attaches req.user if a valid token is provided,
 * but allows the request to continue if no token is provided.
 */
export const optionalAuthenticateUser = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token;
    }

    if (!token) return next();

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return next();
    }

    if (!decoded || !decoded.sub) return next();

    const user = await User.findById(decoded.sub);
    if (user && user.isActive) {
      req.user = user;
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Middleware to authorize specific user roles
 * @param  {...string} roles - Allowed roles
 */
export const authorizeRoles = (...roles) => {
  const allowed = new Set(roles);
  if (allowed.has("OWNER_MANAGER")) {
    allowed.add("OWNER");
    allowed.add("MANAGER");
  }
  if (allowed.has("OWNER")) {
    allowed.add("OWNER_MANAGER");
  }
  if (allowed.has("MANAGER")) {
    allowed.add("OWNER_MANAGER");
  }

  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized("Authentication required before role check."));
    }

    if (!allowed.has(req.user.role)) {
      return next(
        AppError.forbidden(
          `Access forbidden: requires one of the following roles: [${roles.join(", ")}]. Current role: ${req.user.role}`
        )
      );
    }

    next();
  };
};

export default {
  authenticateUser,
  optionalAuthenticateUser,
  authorizeRoles,
};
