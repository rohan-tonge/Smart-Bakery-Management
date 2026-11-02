/**
 * Safe Browser Storage for Customer Details
 * Key: smart_bakery_saved_customer
 * Strictly stores ONLY non-sensitive customer details:
 * - name, phone, email, address (line1, line2, city, state, postalCode)
 * NEVER stores passwords, tokens, payment refs, UTRs, or screenshots.
 */
const STORAGE_KEY = 'smart_bakery_saved_customer';

export function getSavedCustomer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    // Validate structure and ensure types
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const phone = typeof parsed.phone === 'string' ? parsed.phone.trim() : '';
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : '';

    // Must have at least phone and name
    if (!phone && !name) return null;

    let address = null;
    if (parsed.address && typeof parsed.address === 'object') {
      address = {
        addressLine1: typeof parsed.address.addressLine1 === 'string' ? parsed.address.addressLine1.trim() : '',
        addressLine2: typeof parsed.address.addressLine2 === 'string' ? parsed.address.addressLine2.trim() : '',
        city: typeof parsed.address.city === 'string' ? parsed.address.city.trim() : '',
        state: typeof parsed.address.state === 'string' ? parsed.address.state.trim() : '',
        postalCode: typeof parsed.address.postalCode === 'string' ? parsed.address.postalCode.trim() : '',
      };
    }

    return {
      name,
      phone,
      email,
      address,
      savedAt: parsed.savedAt || null,
      orderIds: Array.isArray(parsed.orderIds) ? parsed.orderIds : [],
    };
  } catch {
    return null;
  }
}

export function saveCustomerDetails({ name, phone, email, address, orderId } = {}) {
  try {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
    if (!trimmedPhone && !trimmedName) return false;

    const existing = getSavedCustomer() || {};
    const existingOrderIds = Array.isArray(existing.orderIds) ? existing.orderIds : [];
    const updatedOrderIds = orderId && !existingOrderIds.includes(String(orderId))
      ? [...existingOrderIds, String(orderId)]
      : existingOrderIds;

    const payload = {
      name: trimmedName,
      phone: trimmedPhone,
      email: typeof email === 'string' ? email.trim() : '',
      address:
        address && typeof address === 'object'
          ? {
              addressLine1: typeof address.addressLine1 === 'string' ? address.addressLine1.trim() : '',
              addressLine2: typeof address.addressLine2 === 'string' ? address.addressLine2.trim() : '',
              city: typeof address.city === 'string' ? address.city.trim() : '',
              state: typeof address.state === 'string' ? address.state.trim() : '',
              postalCode: typeof address.postalCode === 'string' ? address.postalCode.trim() : '',
            }
          : null,
      savedAt: new Date().toISOString(),
      orderIds: updatedOrderIds,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedCustomer() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function isReturningCustomer(currentOrderId = null) {
  const saved = getSavedCustomer();
  if (!saved) return false;
  if (!Array.isArray(saved.orderIds) || saved.orderIds.length === 0) {
    return true;
  }
  if (currentOrderId) {
    const isFirstOrder = saved.orderIds.length === 1 && saved.orderIds[0] === String(currentOrderId);
    return !isFirstOrder;
  }
  return saved.orderIds.length > 0;
}
