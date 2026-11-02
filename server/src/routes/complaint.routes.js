import { Router } from "express";
import c from "../controllers/engagement.controller.js";
import {
  authenticateUser,
  authorizeRoles,
} from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import {
  complaintCreate,
  complaintCustomerUpdate,
  complaintAdminUpdate,
  paginationQuery,
  idParam,
} from "../validators/phase10.validator.js";
import { USER_ROLES as R } from "../utils/constants.js";
const r = Router();
r.use(authenticateUser);
r.post(
  "/",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ body: complaintCreate }),
  c.createComplaint,
);
r.get(
  "/my",
  authorizeRoles(R.CUSTOMER),
  validateRequest({ query: paginationQuery }),
  c.myComplaints,
);
r.get(
  "/",
  authorizeRoles(R.OWNER, R.MANAGER),
  validateRequest({ query: paginationQuery }),
  c.listComplaints,
);
r.get("/:id", validateRequest({ params: idParam }), c.getComplaint);
r.patch(
  "/:id",
  validateRequest({ params: idParam }),
  (req, res, next) =>
    validateRequest({
      body:
        req.user?.role === R.CUSTOMER
          ? complaintCustomerUpdate
          : complaintAdminUpdate,
    })(req, res, next),
  c.updateComplaint,
);
export default r;
