import { Router } from "express";
import c from "../controllers/engagement.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  feedbackCreate,
  feedbackUpdate,
  paginationQuery,
  idParam,
} from "../validators/phase10.validator.js";
import { USER_ROLES as R } from "../utils/constants.js";
const r = Router();
r.use(authenticateUser);
r.post(
  "/",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ body: feedbackCreate }),
  c.createFeedback,
);
r.get(
  "/my",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ query: paginationQuery }),
  c.myFeedback,
);
r.get(
  "/",
  authorizeRoles(R.OWNER, R.MANAGER),
  validateRequest({ query: paginationQuery }),
  c.listFeedback,
);
r.get("/:id", validateRequest({ params: idParam }), c.getFeedback);
r.patch(
  "/:id",
  validateRequest({ params: idParam, body: feedbackUpdate }),
  c.updateFeedback,
);
export default r;
