import settingService from "../services/setting.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import capacityService from "../services/capacity.service.js";

export const getPaymentQr = asyncHandler(async (req, res) => {
  const data = await settingService.getPaymentQr();
  return ApiResponse.success(res, {
    message: "Payment QR configuration retrieved successfully",
    data,
  });
});

export const updatePaymentQr = asyncHandler(async (req, res) => {
  const data = await settingService.updatePaymentQr(req.body, req.user._id);
  return ApiResponse.success(res, {
    message: "Payment QR configuration updated successfully",
    data,
  });
});

export const getProductionCapacity = asyncHandler(async (req, res) => {
  const data = await capacityService.getConfiguration();
  return ApiResponse.success(res, { message: "Production capacity configuration retrieved successfully", data });
});

export const updateProductionCapacity = asyncHandler(async (req, res) => {
  const data = await capacityService.updateConfiguration(req.body, req.user._id);
  return ApiResponse.success(res, { message: "Production capacity configuration saved successfully", data });
});

export default {
  getPaymentQr,
  updatePaymentQr,
  getProductionCapacity,
  updateProductionCapacity,
};
