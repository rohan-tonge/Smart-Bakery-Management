import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import service from "../services/notification.service.js";
import eventStream from "../utils/eventStream.js";

export default {
  list: asyncHandler(async (req, res) => {
    const x = await service.list(req.user, req.query);
    return ApiResponse.success(res, { data: { notifications: x.items }, meta: x.meta });
  }),
  unreadCount: asyncHandler(async (req, res) =>
    ApiResponse.success(res, { data: { unreadCount: await service.unreadCount(req.user) } })
  ),
  markRead: asyncHandler(async (req, res) =>
    ApiResponse.success(res, { data: { notification: await service.markRead(req.params.id, req.user) } })
  ),
  markAllRead: asyncHandler(async (req, res) =>
    ApiResponse.success(res, { data: await service.markAllRead(req.user) })
  ),
  stream: (req, res) => {
    eventStream.registerClient(req.user?._id, req.user?.role, res);
  },
};
