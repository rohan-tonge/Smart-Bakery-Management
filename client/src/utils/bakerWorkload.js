/**
 * Baker Workload & Availability Calculation Helpers
 */

/**
 * Format milliseconds into human-readable elapsed or remaining duration.
 * Example: 25 minutes, 1h 15m, 45s
 */
export function formatDurationMinutes(minutes) {
  if (minutes == null || isNaN(minutes)) return '--';
  const mins = Math.round(Number(minutes));
  if (mins < 0) return '0 minutes';
  if (mins === 0) return '< 1 minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

/**
 * Calculate live elapsed time string from a start timestamp and current time
 */
export function calculateElapsedTime(startTime, now = Date.now()) {
  if (!startTime) return '--';
  const startMs = new Date(startTime).getTime();
  if (isNaN(startMs) || startMs <= 0) return '--';
  const diffSecs = Math.max(0, Math.floor((now - startMs) / 1000));
  const hours = Math.floor(diffSecs / 3600);
  const minutes = Math.floor((diffSecs % 3600) / 60);
  const seconds = diffSecs % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Calculate remaining duration in minutes and overdue status
 */
export function calculateRemainingTime(startTime, durationMinutes, now = Date.now()) {
  if (!startTime || !durationMinutes) {
    return { remainingMinutes: null, isOverdue: false, overdueMinutes: 0, formattedRemaining: '--' };
  }
  const startMs = new Date(startTime).getTime();
  if (isNaN(startMs)) {
    return { remainingMinutes: null, isOverdue: false, overdueMinutes: 0, formattedRemaining: '--' };
  }
  const expectedEndMs = startMs + durationMinutes * 60 * 1000;
  const diffMinutes = Math.round((expectedEndMs - now) / 60000);
  const isOverdue = now > expectedEndMs;
  const overdueMinutes = isOverdue ? Math.abs(diffMinutes) : 0;

  let formattedRemaining;
  if (isOverdue) {
    formattedRemaining = `Overdue by ${formatDurationMinutes(overdueMinutes)}`;
  } else if (diffMinutes <= 0) {
    formattedRemaining = '< 1 minute';
  } else {
    formattedRemaining = formatDurationMinutes(diffMinutes);
  }

  return {
    remainingMinutes: diffMinutes,
    isOverdue,
    overdueMinutes,
    formattedRemaining,
    expectedEndTime: new Date(expectedEndMs),
  };
}

/**
 * Format a timestamp into locale time (e.g. 10:30 AM)
 */
export function formatTimeOnly(dateInput) {
  if (!dateInput) return '--';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Normalizes availability status for display
 */
export function normalizeAvailability(workerItem) {
  if (!workerItem) return 'OFFLINE/UNAVAILABLE';
  if (workerItem.worker && workerItem.worker.isActive === false) {
    return 'OFFLINE/UNAVAILABLE';
  }
  if (workerItem.hasConflict) {
    return 'CONFLICT';
  }
  if (workerItem.availability === 'BUSY' || workerItem.activeBatch) {
    return 'BUSY';
  }
  if (workerItem.availability === 'UNAVAILABLE' || workerItem.state === 'UNAVAILABLE') {
    return 'OFFLINE/UNAVAILABLE';
  }
  return 'AVAILABLE';
}
