export class ApiResponse {
  static success(
    res,
    { statusCode = 200, message = "Success", data = null, meta = null },
  ) {
    const payload = {
      success: true,
      message,
    };

    if (data !== null && data !== undefined) {
      payload.data = data;
    }

    if (meta !== null && meta !== undefined) {
      payload.meta = meta;
    }

    return res.status(statusCode).json(payload);
  }

  static created(
    res,
    { message = "Resource created successfully", data = null },
  ) {
    return ApiResponse.success(res, { statusCode: 201, message, data });
  }

  static error(
    res,
    { statusCode = 500, message = "Internal Server Error", errors = [] },
  ) {
    return res.status(statusCode).json({
      success: false,
      message,
      errors,
    });
  }
}

export default ApiResponse;
