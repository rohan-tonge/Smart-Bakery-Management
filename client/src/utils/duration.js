/**
 * Duration formatting helper for Smart Bakery Management System.
 * Consistent formatting: e.g. "45 min", "1 hr", "1 hr 20 min".
 */

export function formatDurationMinutes(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) {
    return '—';
  }
  const totalMins = Math.round(Number(minutes));
  if (totalMins <= 0) return '0 min';

  const hours = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;

  if (hours === 0) {
    return `${remainingMins} min`;
  }
  if (remainingMins === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remainingMins} min`;
}

export default formatDurationMinutes;
