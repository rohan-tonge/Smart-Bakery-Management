import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDurationMinutes,
  calculateElapsedTime,
  calculateRemainingTime,
  normalizeAvailability,
} from './bakerWorkload.js';

test('formatDurationMinutes formats minutes correctly', () => {
  assert.equal(formatDurationMinutes(25), '25 minutes');
  assert.equal(formatDurationMinutes(1), '1 minute');
  assert.equal(formatDurationMinutes(60), '1h');
  assert.equal(formatDurationMinutes(75), '1h 15m');
  assert.equal(formatDurationMinutes(0), '< 1 minute');
  assert.equal(formatDurationMinutes(null), '--');
});

test('calculateElapsedTime computes live seconds, minutes, hours without API calls', () => {
  const baseTime = 1700000000000;
  // 45 seconds later
  assert.equal(calculateElapsedTime(baseTime, baseTime + 45000), '45s');
  // 25 minutes and 10 seconds later
  assert.equal(calculateElapsedTime(baseTime, baseTime + 25 * 60 * 1000 + 10000), '25m 10s');
  // 1 hour, 10 minutes, 5 seconds later
  assert.equal(calculateElapsedTime(baseTime, baseTime + 70 * 60 * 1000 + 5000), '1h 10m 5s');
});

test('calculateRemainingTime computes remaining time and overdue detection correctly', () => {
  const start = 1700000000000;
  const duration = 45; // 45 minutes
  // 25 minutes elapsed -> 20 minutes remaining
  const nowNormal = start + 25 * 60 * 1000;
  const resNormal = calculateRemainingTime(start, duration, nowNormal);
  assert.equal(resNormal.isOverdue, false);
  assert.equal(resNormal.remainingMinutes, 20);
  assert.equal(resNormal.formattedRemaining, '20 minutes');

  // 55 minutes elapsed -> 10 minutes overdue
  const nowOverdue = start + 55 * 60 * 1000;
  const resOverdue = calculateRemainingTime(start, duration, nowOverdue);
  assert.equal(resOverdue.isOverdue, true);
  assert.equal(resOverdue.overdueMinutes, 10);
  assert.equal(resOverdue.formattedRemaining, 'Overdue by 10 minutes');
});

test('normalizeAvailability categorizes baker states correctly', () => {
  assert.equal(normalizeAvailability({ worker: { isActive: false } }), 'OFFLINE/UNAVAILABLE');
  assert.equal(normalizeAvailability({ worker: { isActive: true }, availability: 'BUSY', activeBatch: { batchNumber: 'B1' } }), 'BUSY');
  assert.equal(normalizeAvailability({ worker: { isActive: true }, hasConflict: true }), 'CONFLICT');
  assert.equal(normalizeAvailability({ worker: { isActive: true }, availability: 'AVAILABLE', activeBatch: null }), 'AVAILABLE');
});
