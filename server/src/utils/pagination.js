/**
 * Standard pagination helper
 * @param {number} total - Total number of matching documents
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 */
export const getPaginationMetadata = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

export default getPaginationMetadata;
