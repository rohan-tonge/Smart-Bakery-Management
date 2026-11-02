import { Router } from "express";
import cartController from "../controllers/cart.controller.js";
import { optionalAuthenticateUser } from "../middlewares/auth.middlewares.js";
import { validateRequest } from "../middlewares/validation.middlewares.js";
import { USER_ROLES as R } from "../utils/constants.js";
import {
  cartAddSchema,
  cartUpdateSchema,
  cartItemSchema,
} from "../validators/order.validator.js";
import AppError from "../utils/appError.js";
const router = Router();
router.use(optionalAuthenticateUser);
router.use((req, res, next) => {
  if (req.user && req.user.role !== R.CUSTOMER) {
    return next(AppError.forbidden("Shopping cart is only accessible by customers"));
  }
  next();
});
router.get("/", cartController.get);
router.post(
  "/items",
  validateRequest({ body: cartAddSchema }),
  cartController.add,
);
router.patch(
  "/items/:itemId",
  validateRequest({ params: cartItemSchema, body: cartUpdateSchema }),
  cartController.update,
);
router.delete(
  "/items/:itemId",
  validateRequest({ params: cartItemSchema }),
  cartController.remove,
);
router.delete("/", cartController.clear);
export default router;
