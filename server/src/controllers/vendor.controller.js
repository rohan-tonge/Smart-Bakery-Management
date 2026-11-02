import vendorService from "../services/vendor.service.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const createVendor = asyncHandler(async (req, res) => ApiResponse.created(res, {
  message: "Vendor created successfully", data: { vendor: await vendorService.create(req.body) },
}));
export const listVendors = asyncHandler(async (req, res) => {
  const result = await vendorService.list(req.query);
  return ApiResponse.success(res, { message: "Vendors retrieved successfully", data: { vendors: result.vendors }, meta: result.meta });
});
export const getVendor = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Vendor retrieved successfully", data: { vendor: await vendorService.getById(req.params.id) },
}));
export const updateVendor = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Vendor updated successfully", data: { vendor: await vendorService.update(req.params.id, req.body) },
}));
export const deleteVendor = asyncHandler(async (req, res) => ApiResponse.success(res, {
  message: "Vendor deactivated successfully", data: { vendor: await vendorService.deactivate(req.params.id) },
}));
export default { createVendor, listVendors, getVendor, updateVendor, deleteVendor };
