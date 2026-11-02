export class AppError extends Error {
  constructor(message, statusCode = 500, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad request", errors = []) {
    return new AppError(message, 400, errors);
  }

  static unauthorized(message = "Unauthorized access", errors = []) {
    return new AppError(message, 401, errors);
  }

  static forbidden(message = "Forbidden access", errors = []) {
    return new AppError(message, 403, errors);
  }

  static notFound(message = "Resource not found", errors = []) {
    return new AppError(message, 404, errors);
  }

  static conflict(message = "Resource conflict", errors = []) {
    return new AppError(message, 409, errors);
  }

  static unprocessableEntity(message = "Unprocessable entity", errors = []) {
    return new AppError(message, 422, errors);
  }

  static tooManyRequests(
    message = "Too many requests, please try again later",
    errors = [],
  ) {
    return new AppError(message, 429, errors);
  }

  static internal(message = "Internal server error") {
    return new AppError(message, 500);
  }
}

export default AppError;
