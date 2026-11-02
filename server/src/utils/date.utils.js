/**
 * Date and Timezone Utilities for Bakery Operations
 * Defaults to Asia/Kolkata (IST), configurable via BAKERY_TIMEZONE env var.
 */
export const BAKERY_TIMEZONE = process.env.BAKERY_TIMEZONE || "Asia/Kolkata";

/**
 * Returns today's date string (YYYY-MM-DD) in the bakery's configured timezone.
 * Uses en-CA format which strictly produces YYYY-MM-DD.
 */
export function getBakeryTodayString(timeZone = BAKERY_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

/**
 * Returns tomorrow's date string (YYYY-MM-DD) in the bakery's configured timezone.
 */
export function getBakeryTomorrowString(timeZone = BAKERY_TIMEZONE) {
  const todayStr = getBakeryTodayString(timeZone);
  const [y, m, d] = todayStr.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDay.getUTCFullYear();
  const nm = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(nextDay.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/**
 * Validates whether a date string is strictly from tomorrow onward in the bakery's timezone.
 */
export function isDateNextDayOrLater(dateStr, timeZone = BAKERY_TIMEZONE) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const todayStr = getBakeryTodayString(timeZone);
  return dateStr > todayStr;
}
