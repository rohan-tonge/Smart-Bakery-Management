const decimalParts = (value) => {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError("Money values must be finite and non-negative");
  const [coefficient, exponentText] = String(value).toLowerCase().split("e");
  const exponent = Number(exponentText || 0);
  const [whole, fraction = ""] = coefficient.split(".");
  let digits = `${whole}${fraction}`;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  return { integer: BigInt(digits || "0"), scale };
};

export const rupeesToPaise = (rupees) => {
  const { integer, scale } = decimalParts(rupees);
  const numerator = integer * 100n;
  const divisor = 10n ** BigInt(scale);
  const rounded = (numerator + divisor / 2n) / divisor;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result))
    throw new RangeError("Money amount exceeds the supported range");
  return result;
};

export const multiplyQuantityByRupees = (quantity, rupeesPerUnit) => {
  const q = decimalParts(quantity);
  const p = decimalParts(rupeesPerUnit);
  const numerator = q.integer * p.integer * 100n;
  const divisor = 10n ** BigInt(q.scale + p.scale);
  const rounded = (numerator + divisor / 2n) / divisor;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result))
    throw new RangeError("Money amount exceeds the supported range");
  return result;
};

export const paiseToRupees = (paise) => {
  if (!Number.isSafeInteger(paise))
    throw new TypeError("Paise must be a safe integer");
  return paise / 100;
};

export const sumSafePaise = (values) => {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  const result = Number(total);
  if (!Number.isSafeInteger(result))
    throw new RangeError("Money total exceeds the supported range");
  return result;
};

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatINR = (rupees, options = {}) => {
  const { fallback = "₹0.00" } = options;
  if (rupees === null || rupees === undefined || !Number.isFinite(Number(rupees))) {
    return fallback;
  }
  return inrFormatter.format(Number(rupees));
};

export const formatPaiseINR = (paise, options = {}) => {
  if (paise === null || paise === undefined || !Number.isSafeInteger(Number(paise))) {
    return options.fallback || "₹0.00";
  }
  return formatINR(paiseToRupees(Number(paise)), options);
};

