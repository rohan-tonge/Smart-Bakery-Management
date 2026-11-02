import cartService from "../services/cart.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import AppError from "../utils/appError.js";

const getIdentity = (req) => {
  if (req.user?._id) return { customer: req.user._id };
  const guestId = req.headers["x-guest-id"] || req.query.guestId || req.body?.guestId;
  if (guestId) return { guestId: String(guestId).trim() };
  throw AppError.badRequest("Authentication or x-guest-id header is required for cart operations");
};

export default {
  get: asyncHandler(async (req, res) =>
    ApiResponse.success(res, { data: await cartService.get(getIdentity(req)) }),
  ),
  add: asyncHandler(async (req, res) =>
    ApiResponse.success(res, {
      statusCode: 200,
      data: await cartService.add(getIdentity(req), req.body),
    }),
  ),
  update: asyncHandler(async (req, res) =>
    ApiResponse.success(res, {
      data: await cartService.update(getIdentity(req), req.params.itemId, req.body),
    }),
  ),
  remove: asyncHandler(async (req, res) =>
    ApiResponse.success(res, {
      data: await cartService.remove(getIdentity(req), req.params.itemId),
    }),
  ),
  clear: asyncHandler(async (req, res) =>
    ApiResponse.success(res, { data: await cartService.clear(getIdentity(req)) }),
  ),
};
