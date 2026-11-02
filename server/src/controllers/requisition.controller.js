import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import requisitionService from "../services/requisition.service.js";

export default {
  getBatchRequirements: asyncHandler(async (req, res) => {
    const data = await requisitionService.getBatchRequirements(
      req.params.id,
      req.user,
    );
    return ApiResponse.success(res, {
      message: "Batch requirements retrieved successfully",
      data,
    });
  }),

  create: asyncHandler(async (req, res) => {
    const requisition = await requisitionService.createRequisition(
      req.params.id,
      req.body,
      req.user,
    );
    return ApiResponse.created(res, {
      message: "Ingredient requisition submitted successfully",
      data: { requisition },
    });
  }),

  list: asyncHandler(async (req, res) => {
    const result = await requisitionService.listRequisitions(
      req.query,
      req.user,
    );
    return ApiResponse.success(res, {
      message: "Requisitions retrieved successfully",
      data: { requisitions: result.requisitions },
      meta: result.meta,
    });
  }),

  get: asyncHandler(async (req, res) => {
    const requisition = await requisitionService.getRequisition(
      req.params.id,
      req.user,
    );
    return ApiResponse.success(res, {
      message: "Requisition retrieved successfully",
      data: { requisition },
    });
  }),

  approve: asyncHandler(async (req, res) => {
    const requisition = await requisitionService.approveRequisition(
      req.params.id,
      req.body,
      req.user,
    );
    return ApiResponse.success(res, {
      message: "Requisition approved successfully",
      data: { requisition },
    });
  }),

  reject: asyncHandler(async (req, res) => {
    const requisition = await requisitionService.rejectRequisition(
      req.params.id,
      req.body,
      req.user,
    );
    return ApiResponse.success(res, {
      message: "Requisition rejected",
      data: { requisition },
    });
  }),

  issue: asyncHandler(async (req, res) => {
    const requisition = await requisitionService.issueIngredients(
      req.params.id,
      req.body,
      req.user,
    );
    return ApiResponse.success(res, {
      message: "Ingredients issued successfully and stock deducted",
      data: { requisition },
    });
  }),
};
