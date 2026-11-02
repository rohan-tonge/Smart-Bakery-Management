/**
 * Reusable request validation middleware using Zod
 * @param {object} schema - { body?: ZodSchema, query?: ZodSchema, params?: ZodSchema }
 */
export const validateRequest = (schema) => async (req, res, next) => {
  try {
    if (schema.body) {
      req.body = await schema.body.parseAsync(req.body);
    }
    if (schema.query) {
      req.query = await schema.query.parseAsync(req.query);
    }
    if (schema.params) {
      req.params = await schema.params.parseAsync(req.params);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export default validateRequest;
