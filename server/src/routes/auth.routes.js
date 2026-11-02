import { Router } from "express";
import authController from "../controllers/auth.controller.js";
import { authenticateUser } from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { authRateLimiter } from "../middlewares/rateLimit.middlewares.js";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
} from "../validators/auth.validator.js";

const router = Router();

// Public routes with rate limiting
router.post(
  "/register",
  authRateLimiter,
  validateRequest({ body: registerSchema }),
  authController.register,
);

router.post(
  "/login",
  authRateLimiter,
  validateRequest({ body: loginSchema }),
  authController.login,
);

router.post("/refresh", authRateLimiter, authController.refreshToken);

router.post("/logout", authRateLimiter, authController.logout);

// Protected routes
router.get("/me", authenticateUser, authController.getMe);

router.patch(
  "/change-password",
  authRateLimiter,
  authenticateUser,
  validateRequest({ body: changePasswordSchema }),
  authController.changePassword,
);

export default router;
