import AppError from "../utils/appError.js";

export const notFoundMiddleware = (req, res, next) => {
  next(
    AppError.notFound(
      `Resource not found - Cannot ${req.method} ${req.originalUrl}`
    )
  );
};

export default notFoundMiddleware;
