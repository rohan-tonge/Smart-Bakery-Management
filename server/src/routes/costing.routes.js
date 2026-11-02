import { Router } from "express";
import controller from "../controllers/costing.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  costSummaryQuerySchema,
  estimateSchema,
  priceImpactSchema,
} from "../validators/phase9.validator.js";
import { USER_ROLES } from "../utils/constants.js";
const router = Router();
router.use(authenticateUser, authorizeRoles(USER_ROLES.OWNER));
router.post(
  "/estimate",
  validateRequest({ body: estimateSchema }),
  controller.estimate,
);
router.post(
  "/price-impact",
  validateRequest({ body: priceImpactSchema }),
  controller.priceImpact,
);
router.get(
  "/summary",
  validateRequest({ query: costSummaryQuerySchema }),
  controller.summary,
);
export default router;
