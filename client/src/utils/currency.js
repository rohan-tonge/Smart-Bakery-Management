/**
 * Smart Bakery Management System - Shared Currency & INR Formatting Utilities
 *
 * All monetary amounts are formatted according to Indian English locale (en-IN)
 * with the standard Indian Rupee symbol (₹) and Indian number grouping (lakh/crore).
 *
 * Storage conventions:
 * - Backend Batch Costing: stored in PAISE (integer, 100 paise = ₹1.00)
 * - Payments: stored in PAISE (integer, e.g. 240000 paise = ₹2400.00)
 * - Catalog Prices / Worker Labour Rates / Lot Unit Costs: stored in RUPEES (float/number >= 0)
 * - Order Subtotal / Total: stored in RUPEES (float/number >= 0)
 */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * Formats a rupee amount as Indian currency (e.g., 125000 -> "₹1,25,000.00").
 * @param {number|string|null|undefined} amountInRupees - The amount in rupees.
 * @param {Object} [options] - Optional formatting options.
 * @param {string} [options.fallback="₹0.00"] - String to return if amount is invalid.
 * @param {number} [options.minimumFractionDigits=2] - Minimum fractional digits.
 * @param {number} [options.maximumFractionDigits=2] - Maximum fractional digits.
 * @returns {string} Formatted INR currency string.
 */
export function formatCurrency(amountInRupees, options = {}) {
  const {
    fallback = '₹0.00',
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = options;

  if (amountInRupees === null || amountInRupees === undefined || amountInRupees === '') {
    return fallback;
  }

  const num = typeof amountInRupees === 'number' ? amountInRupees : Number(amountInRupees);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  if (minimumFractionDigits === 2 && maximumFractionDigits === 2) {
    return inrFormatter.format(num);
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(num);
}

/**
 * Formats an amount in paise to Indian currency (e.g., 12500000 -> "₹1,25,000.00").
 * @param {number|null|undefined} amountInPaise - The amount in paise.
 * @param {Object} [options]
 * @returns {string} Formatted INR currency string.
 */
export function formatPaise(amountInPaise, options = {}) {
  if (amountInPaise === null || amountInPaise === undefined || !Number.isFinite(Number(amountInPaise))) {
    return options.fallback || '₹0.00';
  }
  return formatCurrency(Number(amountInPaise) / 100, options);
}

/**
 * Formats an hourly labour rate with unit (e.g. 120 -> "₹120.00/hour").
 * @param {number|string|null|undefined} rateInRupees
 * @returns {string}
 */
export function formatHourlyRate(rateInRupees) {
  if (rateInRupees === null || rateInRupees === undefined || rateInRupees === '') {
    return '—';
  }
  const num = Number(rateInRupees);
  if (!Number.isFinite(num) || num < 0) {
    return '—';
  }
  return `${formatCurrency(num)}/hour`;
}

/**
 * Formats a unit cost with unit (e.g. 40, "kg" -> "₹40.00/kg").
 * @param {number|string|null|undefined} costInRupees
 * @param {string} [unit="unit"]
 * @returns {string}
 */
export function formatUnitCost(costInRupees, unit = 'unit') {
  if (costInRupees === null || costInRupees === undefined || costInRupees === '') {
    return '—';
  }
  const num = Number(costInRupees);
  if (!Number.isFinite(num) || num < 0) {
    return '—';
  }
  return `${formatCurrency(num)}/${unit || 'unit'}`;
}

/**
 * Compact currency for KPI summary cards (e.g. ₹1,25,000 instead of ₹1,25,000.00 if whole).
 * @param {number|string|null|undefined} amountInRupees
 * @returns {string}
 */
export function formatCompactCurrency(amountInRupees) {
  if (amountInRupees === null || amountInRupees === undefined || amountInRupees === '') {
    return '₹0';
  }
  const num = Number(amountInRupees);
  if (!Number.isFinite(num)) {
    return '₹0';
  }
  if (Number.isInteger(num)) {
    return inrCompactFormatter.format(num);
  }
  return inrFormatter.format(num);
}

export default formatCurrency;
