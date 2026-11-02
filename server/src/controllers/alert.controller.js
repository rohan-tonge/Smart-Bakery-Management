import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import service from "../services/alert.service.js";
export default {
  list: asyncHandler(async (req, res) =>
    ApiResponse.success(res, {
      data: { alerts: await service.list(req.user) },
    }),
  ),
};
