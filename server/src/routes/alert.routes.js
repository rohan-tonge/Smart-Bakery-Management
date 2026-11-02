import { Router } from "express";
import c from "../controllers/alert.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { USER_ROLES as R } from "../utils/constants.js";
const r = Router();
r.get(
  "/",
  authenticateUser,
  authorizeRoles(R.OWNER, R.MANAGER, R.PRODUCTION_STAFF),
  c.list,
);
export default r;
