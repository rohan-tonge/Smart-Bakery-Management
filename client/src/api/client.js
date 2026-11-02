const API_BASE = (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/+$/, '') : '') + '/api/v1';

// Persistent Guest ID generator and getter
export function getGuestId() {
  let guestId = localStorage.getItem('smart_bakery_guest_id');
  if (!guestId) {
    guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('smart_bakery_guest_id', guestId);
  }
  return guestId;
}

// Token helper
export function getToken() {
  return localStorage.getItem('smart_bakery_token') || '';
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('smart_bakery_token', token);
  } else {
    localStorage.removeItem('smart_bakery_token');
  }
}

export function createNotificationEventSource() {
  const token = getToken();
  return new EventSource(`${API_BASE}/notifications/stream?token=${encodeURIComponent(token || '')}`);
}

let refreshPromise = null;

export const executeTokenRefresh = async () => {
  if (refreshPromise) {
    return refreshPromise;
  }
  const guestId = getGuestId();
  refreshPromise = (async () => {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestId,
      },
    });
    const refreshData = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(refreshData.message || 'Session expired');
    }
    const newToken =
      refreshData.data?.accessToken ||
      refreshData.data?.token ||
      refreshData.accessToken ||
      refreshData.token;
    const userData = refreshData.data?.user || refreshData.user;
    if (newToken) {
      setToken(newToken);
      return {
        success: true,
        accessToken: newToken,
        user: userData,
        data: refreshData.data || refreshData,
      };
    }
    throw new Error('No access token received during refresh');
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
};

// Centralized request wrapper
async function request(endpoint, options = {}, isRetry = false) {
  const token = getToken();
  const guestId = getGuestId();

  const headers = {
    'Content-Type': 'application/json',
    'x-guest-id': guestId,
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch (fetchErr) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const err = new Error('You are currently offline. A live connection is required to complete this action.');
      err.isOffline = true;
      throw err;
    }
    throw fetchErr;
  }

  // Automatically attempt token refresh on 401 Unauthorized for protected requests
  if (
    response.status === 401 &&
    !isRetry &&
    !endpoint.startsWith('/auth/login') &&
    !endpoint.startsWith('/auth/register') &&
    !endpoint.startsWith('/auth/refresh')
  ) {
    try {
      const refreshResult = await executeTokenRefresh();
      if (refreshResult && refreshResult.accessToken) {
        return request(endpoint, options, true);
      }
    } catch {
      setToken(null);
      // Leave navigation to the route guard or calling screen.
    }
  }

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    let errorMsg = data.message || data.error || `HTTP ${response.status} Request Failed`;
    if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
      const fieldDetails = data.errors
        .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
        .filter(Boolean)
        .join(', ');
      if (fieldDetails && !errorMsg.includes(fieldDetails)) {
        errorMsg = `${errorMsg} (${fieldDetails})`;
      }
    }
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  // Handle binary image or explicitly requested blob responses
  if (contentType.startsWith('image/') || options.responseType === 'blob') {
    const blob = await response.blob();
    const dataUrl = URL.createObjectURL(blob);
    return {
      success: true,
      data: {
        blob,
        dataUrl,
        mimeType: contentType.split(';')[0].trim() || blob.type,
        fileSize: blob.size,
        fileName: response.headers.get('x-payment-proof-file-name') || '',
        uploadedAt: response.headers.get('x-payment-proof-uploaded-at') || null,
      },
    };
  }

  const data = await response.json().catch(() => ({}));

  return data;
}

export const api = {
  // Public Catalog
  getCategories: () => request('/categories'),
  getProducts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/products${query ? '?' + query : ''}`);
  },
  getProductById: (id) => request(`/products/${id}`),

  // Cart (Works for Guest & Customer seamlessly)
  getCart: () => request('/cart'),
  addToCart: (item) => request('/cart/items', { method: 'POST', body: JSON.stringify(item) }),
  updateCartItem: (itemId, update) =>
    request(`/cart/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(update) }),
  removeCartItem: (itemId) => request(`/cart/items/${itemId}`, { method: 'DELETE' }),
  clearCart: () => request('/cart', { method: 'DELETE' }),

  // Order & Guest Checkout
  checkFeasibility: (items) => request('/orders/check-feasibility', { method: 'POST', body: JSON.stringify({ items }) }),
  getDeliverySlots: (payload = {}) => request('/orders/delivery-slots', { method: 'POST', body: JSON.stringify(payload) }),
  checkout: (orderPayload, idempotencyKey) => request('/orders', {
    method: 'POST',
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    body: JSON.stringify(orderPayload),
  }),
  getMyOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders/my${query ? '?' + query : ''}`);
  },
  getOrderById: (id) => request(`/orders/${id}`),
  trackOrder: ({ orderNumber, phone, token }) => {
    const query = new URLSearchParams({
      orderNumber: orderNumber || '',
      ...(phone ? { phone } : {}),
      ...(token ? { token } : {}),
    }).toString();
    return request(`/orders/track?${query}`);
  },
  markCustomerPaid: (orderId, { screenshot, mimeType, fileName, amount, token, transactionReference, isReturningCustomer }) =>
    request(`/orders/${orderId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ screenshot, mimeType, fileName, amount, token, transactionReference, isReturningCustomer }),
    }),
  getPaymentProof: (orderId, token) =>
    request(
      `/orders/${orderId}/payment-proof${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      { responseType: 'blob' }
    ),

  // Payment QR Settings (Public read, Owner/Manager write)
  getPaymentQr: () => request('/settings/payment-qr'),
  updatePaymentQr: (payload) => request('/settings/payment-qr', { method: 'PUT', body: JSON.stringify(payload) }),
  getProductionCapacity: () => request('/settings/production-capacity'),
  updateProductionCapacity: (payload) => request('/settings/production-capacity', { method: 'PUT', body: JSON.stringify(payload) }),

  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  refreshToken: executeTokenRefresh,
  getMe: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // Owner / Manager Management APIs
  getAllOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders${query ? '?' + query : ''}`);
  },
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  confirmPayment: (id, note) => request(`/orders/${id}/confirm-payment`, { method: 'PATCH', body: JSON.stringify({ note }) }),
  rejectPayment: (id, note) => request(`/orders/${id}/reject-payment`, { method: 'PATCH', body: JSON.stringify({ note }) }),
  cancelOrder: (id, payload = {}) => request(`/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(payload) }),
  placeOrderHold: (id, payload) => request(`/orders/${id}/hold`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelOrderFromHold: (id, payload = {}) => request(`/orders/${id}/cancel-hold`, { method: 'POST', body: JSON.stringify(payload) }),
  getOrderInventoryCheck: (id) => request(`/orders/${id}/inventory-check`),
  fulfillOrderFromStock: (id) => request(`/orders/${id}/fulfill-from-stock`, { method: 'POST' }),

  createProduct: (payload) => request('/products', { method: 'POST', body: JSON.stringify(payload) }),
  updateProduct: (id, payload) => request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),

  addVariant: (productId, payload) => request(`/products/${productId}/variants`, { method: 'POST', body: JSON.stringify(payload) }),
  updateVariant: (productId, variantId, payload) =>
    request(`/products/${productId}/variants/${variantId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateVariantPrice: (productId, variantId, price) =>
    request(`/products/${productId}/variants/${variantId}`, { method: 'PATCH', body: JSON.stringify({ price: Number(price) }) }),
  deleteVariant: (productId, variantId) => request(`/products/${productId}/variants/${variantId}`, { method: 'DELETE' }),
  getProductCosting: (productId) => request(`/products/${productId}/costing`),

  // Recipes
  getRecipe: (productId, variantId) => request(`/products/${productId}/variants/${variantId}/recipe`),
  createRecipe: (productId, variantId, payload) =>
    request(`/products/${productId}/variants/${variantId}/recipe`, { method: 'POST', body: JSON.stringify(payload) }),
  updateRecipe: (productId, variantId, payload) =>
    request(`/products/${productId}/variants/${variantId}/recipe`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteRecipe: (productId, variantId) =>
    request(`/products/${productId}/variants/${variantId}/recipe`, { method: 'DELETE' }),
  calculateRecipe: (payload) =>
    request('/recipes/calculate', { method: 'POST', body: JSON.stringify(payload) }),

  createCategory: (payload) => request('/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCategory: (id, payload) => request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

  getIngredients: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/ingredients${query ? '?' + query : ''}`);
  },
  createIngredient: (payload) => request('/ingredients', { method: 'POST', body: JSON.stringify(payload) }),
  updateIngredient: (id, payload) => request(`/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteIngredient: (id) => request(`/ingredients/${id}`, { method: 'DELETE' }),

  // Vendors & Suppliers
  getVendors: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/vendors${query ? '?' + query : ''}`);
  },
  createVendor: (payload) => request('/vendors', { method: 'POST', body: JSON.stringify(payload) }),
  updateVendor: (id, payload) => request(`/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVendor: (id) => request(`/vendors/${id}`, { method: 'DELETE' }),

  // Purchases / Receiving Stock
  getPurchases: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/purchases${query ? '?' + query : ''}`);
  },
  createPurchase: (payload) => request('/purchases', { method: 'POST', body: JSON.stringify(payload) }),
  getPurchaseById: (id) => request(`/purchases/${id}`),

  // Inventory & Stock
  getInventory: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/inventory${query ? '?' + query : ''}`);
  },
  adjustInventory: (payload) => request('/inventory/adjustments', { method: 'POST', body: JSON.stringify(payload) }),
  getLowStock: () => request('/inventory/low-stock'),
  getExpiringInventory: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/inventory/expiring${query ? '?' + query : ''}`);
  },
  getInventoryTransactions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/inventory/transactions${query ? '?' + query : ''}`);
  },
  getInventoryValue: () => request('/inventory/value'),

  // Production Plans
  getProductionPlans: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/production/plans${query ? '?' + query : ''}`);
  },
  createProductionPlan: (payload) => request('/production/plans', { method: 'POST', body: JSON.stringify(payload) }),
  approveProductionPlan: (id) => request(`/production/plans/${id}/approve`, { method: 'POST' }),

  // Production Batches
  getBatches: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/production/batches${query ? '?' + query : ''}`);
  },
  createBatch: (payload) =>
    request('/production/batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  assignOrderToProduction: (orderId, payload) => {
    const body = Array.isArray(payload)
      ? { workers: payload }
      : typeof payload === 'object' && payload !== null
        ? payload
        : { worker: payload };
    return request(`/production/orders/${orderId}/assign`, { method: 'POST', body: JSON.stringify(body) });
  },
  getRecommendedWorkersForOrder: (orderId) => request(`/production/orders/${orderId}/recommendations`),
  getRecommendedWorkersForBatch: (batchId) => request(`/production/batches/${batchId}/recommendations`),
  reassignBatch: (batchId, payload) =>
    request(`/production/batches/${batchId}/reassign`, { method: 'POST', body: JSON.stringify(payload) }),
  getProductionTeamStatus: () => request('/production/team-status'),
  getWorkerWorkloadStatus: () => request('/workers/workload-status'),
  getBakerAvailability: () => request('/production/team-status'),
  updateBatch: (id, payload) => request(`/production/batches/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getBatchCost: (id) => request(`/production/batches/${id}/cost`),
  finalizeBatchCost: (id, payload = {}) =>
    request(`/production/batches/${id}/cost/finalize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveBatchCostDraft: (id, payload = {}) =>
    request(`/production/batches/${id}/cost/draft`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  updateBatchAssignment: (id, payload) =>
    request(`/production/batches/${id}/assignment`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  cancelBatch: (id, payload = {}) =>
    request(`/production/batches/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  placeBatchHold: (id, payload) =>
    request(`/production/batches/${id}/hold`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBatchHoldInstruction: (id, payload) =>
    request(`/production/batches/${id}/hold`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  acknowledgeBatchHold: (id, payload) =>
    request(`/production/batches/${id}/acknowledge-hold`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resolveBatchHold: (id, payload) =>
    request(`/production/batches/${id}/resolve-hold`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // In-App Notifications
  getNotifications: (params = {}) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return request(`/notifications${query ? '?' + query : ''}`);
  },
  getUnreadNotificationCount: () => request('/notifications/unread-count'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'PATCH' }),

  // Ingredient Requisitions
  getBatchRequirements: (batchId) => request(`/requisitions/batch/${batchId}/requirements`),
  createRequisition: (batchId, payload) =>
    request(`/requisitions/batch/${batchId}`, { method: 'POST', body: JSON.stringify(payload) }),
  getRequisitions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/requisitions${query ? '?' + query : ''}`);
  },
  getRequisitionById: (id) => request(`/requisitions/${id}`),
  approveRequisition: (id, payload = {}) =>
    request(`/requisitions/${id}/approve`, { method: 'POST', body: JSON.stringify(payload) }),
  rejectRequisition: (id, reason) =>
    request(`/requisitions/${id}/reject`, { method: 'POST', body: JSON.stringify(typeof reason === 'string' ? { reason } : reason) }),
  issueRequisition: (id, payload = {}) =>
    request(`/requisitions/${id}/issue`, { method: 'POST', body: JSON.stringify(payload) }),

  // Workers & Production Staff Management
  getWorkers: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/workers${query ? '?' + query : ''}`);
  },
  createWorker: (payload) => request('/workers', { method: 'POST', body: JSON.stringify(payload) }),
  getWorkerById: (id) => request(`/workers/${id}`),
  updateWorker: (id, payload) => request(`/workers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteWorker: (id) => request(`/workers/${id}`, { method: 'DELETE' }),
  updateUserStatus: (id, isActive) => request(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),

  getAnalyticsDashboard: () => request('/analytics/dashboard'),
  getOrdersReport: () => request('/analytics/orders'),
  getProductsReport: () => request('/analytics/products'),
  getInventoryReport: () => request('/analytics/inventory'),
  getProductionReport: () => request('/analytics/production'),
  getSalesAnalytics: () => request('/analytics/sales'),
  getSalesAnalyticsSummary: (params = {}) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return request(`/analytics/summary${query ? '?' + query : ''}`);
  },
  getSalesOverTime: (params = {}) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return request(`/analytics/sales-over-time${query ? '?' + query : ''}`);
  },
  getTopProducts: (params = {}) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return request(`/analytics/top-products${query ? '?' + query : ''}`);
  },
  getProductPerformance: (params = {}) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return request(`/analytics/product-performance${query ? '?' + query : ''}`);
  },
  exportSalesAnalyticsCsv: async (params = {}) => {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    const token = getToken();
    const guestId = getGuestId();
    const headers = { 'x-guest-id': guestId };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/analytics/export${query ? '?' + query : ''}`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to export CSV report');
    }
    return res.text();
  },
  getAlerts: () => request('/alerts'),

  // Production Staff Workstation APIs
  getMyBatches: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/workers/me/batches${query ? '?' + query : ''}`);
  },
  getBatchDetails: (id) => request(`/production/batches/${id}`),
  acceptBatch: (id, planPayload) =>
    request(`/production/batches/${id}/accept`, { method: 'POST', body: JSON.stringify(planPayload) }),
  rejectBatch: (id, reason) =>
    request(`/production/batches/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  verifyBatch: (id, planPayload) =>
    request(`/production/batches/${id}/verify`, { method: 'POST', body: JSON.stringify(planPayload) }),
  startBatch: (id, payload) =>
    request(`/production/batches/${id}/start`, { method: 'POST', ...(payload ? { body: JSON.stringify(payload) } : {}) }),
  consumeBatchIngredients: (id) => request(`/production/batches/${id}/consume`, { method: 'POST' }),
  completeBatch: (id, payload) =>
    request(`/production/batches/${id}/complete`, { method: 'POST', body: JSON.stringify(payload) }),
  packageBatch: (id, payload = {}) =>
    request(`/production/batches/${id}/package`, { method: 'POST', body: JSON.stringify(payload) }),
  finalizeBatch: (id) => request(`/production/batches/${id}/finalize`, { method: 'POST' }),
  deliverBatch: (id) => request(`/production/batches/${id}/deliver`, { method: 'POST' }),

  recordWastage: (payload) => request('/wastage', { method: 'POST', body: JSON.stringify(payload) }),
};

export default api;
