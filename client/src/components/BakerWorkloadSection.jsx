import React, { useState, useEffect, useRef } from 'react';
import {
  ChefHat,
  Clock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Layers,
  Activity,
  AlertCircle,
  Eye,
  X,
  Package,
  ArrowRight,
  Flame,
  UserCheck,
  UserX,
} from 'lucide-react';
import { api } from '../api/client';
import {
  calculateElapsedTime,
  calculateRemainingTime,
  formatTimeOnly,
  formatDurationMinutes,
  normalizeAvailability,
} from '../utils/bakerWorkload';

export default function BakerWorkloadSection({
  onNavigateToProduction,
  autoPollInterval = 10000,
}) {
  const [teamStatus, setTeamStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(Date.now());

  const isMountedRef = useRef(true);

  // Fetch workload data from the authoritative backend endpoint
  const fetchWorkload = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await api.getProductionTeamStatus();
      if (!isMountedRef.current) return;
      const data = res?.data?.teamStatus || res?.data?.bakers || res?.data?.workers || res?.data || [];
      setTeamStatus(Array.isArray(data) ? data : []);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (!isMountedRef.current) return;
      // Do not falsely display bakers as available on error
      setError(err.message || 'Unable to load live baker availability from kitchen server');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  // Initial fetch and 10-15s background polling
  useEffect(() => {
    isMountedRef.current = true;
    fetchWorkload(false);

    const pollTimer = setInterval(() => {
      fetchWorkload(false);
    }, autoPollInterval);

    return () => {
      isMountedRef.current = false;
      clearInterval(pollTimer);
    };
  }, [autoPollInterval]);

  // Live 1-second ticker for local elapsed time updates without API requests
  useEffect(() => {
    const tickTimer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(tickTimer);
  }, []);

  // Compute summary stats
  const totalBakers = teamStatus.length;
  const busyBakers = teamStatus.filter((b) => b.availability === 'BUSY' || b.hasConflict || b.activeBatch).length;
  const availableBakers = teamStatus.filter((b) => b.availability === 'AVAILABLE' && !b.activeBatch && b.worker?.isActive !== false).length;
  const conflictCount = teamStatus.filter((b) => b.hasConflict).length;

  return (
    <section
      className="baker-workload-container card"
      style={{
        padding: '1.5rem',
        marginBottom: '1.75rem',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--card-bg)',
      }}
      aria-labelledby="baker-workload-heading"
    >
      {/* Section Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
          borderBottom: '1px solid var(--border-subtle, #f5f2ed)',
          paddingBottom: '1rem',
        }}
      >
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'var(--primary-light, #fff7ed)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                flexShrink: 0,
              }}
            >
              <ChefHat size={18} />
            </div>
            <h3
              id="baker-workload-heading"
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: 'var(--text-main)',
                margin: 0,
              }}
            >
              Baker Availability & Staff Workload
            </h3>
          </div>
          <p
            style={{
              fontSize: '0.84rem',
              color: 'var(--text-muted)',
              margin: 0,
              lineHeight: 1.45,
            }}
          >
            Live production workstation tracking, active batch tasks, and 1-active-batch concurrency enforcement.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Quick Metrics */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              background: 'var(--border-subtle, #f5f2ed)',
              padding: '4px 10px',
              borderRadius: '9999px',
              color: 'var(--text-main)',
            }}
          >
            <span>Staff: <strong>{totalBakers}</strong></span>
            <span>•</span>
            <span style={{ color: 'var(--primary)' }}>Busy: <strong>{busyBakers}</strong></span>
            <span>•</span>
            <span style={{ color: 'var(--success)' }}>Available: <strong>{availableBakers}</strong></span>
            {conflictCount > 0 && (
              <>
                <span>•</span>
                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                  Conflicts: <strong>{conflictCount}</strong>
                </span>
              </>
            )}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchWorkload(true)}
            disabled={refreshing || loading}
            className="btn btn-outline btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.78rem',
              padding: '6px 10px',
              minHeight: '34px',
            }}
            title="Refresh baker workload status"
            aria-label="Refresh live baker workload"
          >
            <RefreshCw size={13} className={refreshing ? 'spin-icon' : ''} />
            <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div
          className="alert alert-danger"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1.25rem',
            padding: '0.85rem 1rem',
          }}
          role="alert"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.86rem' }}>
              <strong>Availability Error:</strong> {error}
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchWorkload(true)}
            className="btn btn-sm btn-outline"
            style={{ fontSize: '0.78rem', padding: '4px 8px' }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Global Concurrency Conflict Alert Banner */}
      {conflictCount > 0 && (
        <div
          style={{
            background: 'var(--danger-light, #fee2e2)',
            border: '1px solid var(--danger, #b91c1c)',
            borderRadius: 'var(--radius)',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            color: 'var(--danger, #b91c1c)',
          }}
        >
          <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '2px' }}>
              Workload Concurrency Conflict Detected ({conflictCount} staff member{conflictCount > 1 ? 's' : ''})
            </strong>
            <span style={{ fontSize: '0.82rem', lineHeight: 1.4 }}>
              The single active batch concurrency policy is violated. One or more bakers are assigned to multiple actively running production tasks simultaneously. Review the highlighted conflict cards below.
            </span>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && teamStatus.length === 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius)',
                padding: '1.25rem',
                background: 'var(--bg-main, #fbf9f6)',
                minHeight: '160px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ height: '20px', width: '60%', background: '#e2e8f0', borderRadius: '4px' }}></div>
              <div style={{ height: '14px', width: '40%', background: '#e2e8f0', borderRadius: '4px' }}></div>
              <div style={{ height: '40px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: 'auto' }}></div>
            </div>
          ))}
        </div>
      ) : teamStatus.length === 0 && !error ? (
        /* Empty State */
        <div
          style={{
            textAlign: 'center',
            padding: '2.5rem 1rem',
            color: 'var(--text-muted)',
            border: '1px dashed var(--border-color)',
            borderRadius: 'var(--radius)',
          }}
        >
          <ChefHat size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.5 }} />
          <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-main)', fontSize: '1rem' }}>
            No Production Bakers Registered
          </h4>
          <p style={{ margin: 0, fontSize: '0.84rem' }}>
            Add production staff in the Staff section to monitor baker workloads and assignment availability.
          </p>
        </div>
      ) : (
        /* Baker Cards Grid */
        <div
          className="baker-cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '1.15rem',
          }}
        >
          {teamStatus.map((item) => {
            const worker = item.worker || {};
            const availability = normalizeAvailability(item);
            const isBusy = availability === 'BUSY';
            const isConflict = availability === 'CONFLICT';
            const isOffline = availability === 'OFFLINE/UNAVAILABLE';
            const isAvailable = availability === 'AVAILABLE';

            const activeBatch = item.activeBatch;
            const activeBatches = item.activeBatches || (activeBatch ? [activeBatch] : []);

            return (
              <div
                key={worker._id || worker.email}
                className={`baker-workload-card ${isConflict ? 'card-conflict' : isBusy ? 'card-busy' : 'card-available'}`}
                style={{
                  border: isConflict
                    ? '1.5px solid var(--danger, #b91c1c)'
                    : isBusy
                    ? '1.5px solid var(--primary, #ea580c)'
                    : '1px solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  background: isConflict
                    ? 'var(--card-bg)'
                    : isBusy
                    ? 'var(--card-bg)'
                    : 'var(--card-bg)',
                  padding: '1.2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: isBusy || isConflict ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {/* Baker Identity & Availability Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong
                        style={{
                          fontSize: '1.05rem',
                          color: 'var(--text-main)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={worker.name}
                      >
                        {worker.name}
                      </strong>
                    </div>
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--text-muted)',
                        marginTop: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{worker.jobDesignation || 'Production Baker'}</span>
                      {worker.phone && <span>• {worker.phone}</span>}
                    </div>
                  </div>

                  {/* Availability Badge */}
                  <div>
                    {isConflict ? (
                      <span
                        className="badge"
                        style={{
                          background: '#fee2e2',
                          color: '#b91c1c',
                          border: '1px solid #f87171',
                          fontWeight: 800,
                          fontSize: '0.74rem',
                          letterSpacing: '0.02em',
                        }}
                      >
                        ⚠️ CONFLICT ({activeBatches.length})
                      </span>
                    ) : isBusy ? (
                      <span
                        className="badge"
                        style={{
                          background: item.activeBatch?.isOverdue ? '#fee2e2' : '#fff7ed',
                          color: item.activeBatch?.isOverdue ? '#b91c1c' : '#c2410c',
                          border: item.activeBatch?.isOverdue ? '1px solid #fca5a5' : '1px solid #fed7aa',
                          fontWeight: 700,
                          fontSize: '0.74rem',
                        }}
                      >
                        {item.activeBatch?.isOverdue ? '⚠️ OVERDUE BUSY' : '● BUSY'}
                      </span>
                    ) : isOffline ? (
                      <span
                        className="badge"
                        style={{
                          background: '#f5f5f4',
                          color: '#78716c',
                          border: '1px solid #e7e5e4',
                          fontSize: '0.74rem',
                        }}
                      >
                        ○ OFFLINE
                      </span>
                    ) : (
                      <span
                        className="badge"
                        style={{
                          background: '#f0fdf4',
                          color: '#15803d',
                          border: '1px solid #bbf7d0',
                          fontWeight: 700,
                          fontSize: '0.74rem',
                        }}
                      >
                        ✓ AVAILABLE
                      </span>
                    )}
                  </div>
                </div>

                {/* Conflict Detail Banner (if baker has multiple running batches) */}
                {isConflict && (
                  <div
                    style={{
                      background: '#fff1f2',
                      border: '1px solid #fecdd3',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.75rem',
                      fontSize: '0.8rem',
                      color: '#9f1239',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700, marginBottom: '4px' }}>
                      <AlertTriangle size={14} /> Concurrency Policy Violation
                    </div>
                    <p style={{ margin: '0 0 0.5rem 0', lineHeight: 1.35 }}>
                      Baker is handling {activeBatches.length} active batches concurrently. The bakery single-active-batch rule permits only 1 running batch per baker.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {activeBatches.map((b) => (
                        <div
                          key={b._id || b.batchNumber}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: '#ffffff',
                            border: '1px solid #fecdd3',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div>
                            <strong>{b.batchNumber}</strong> · <span>{b.productName}</span> ({b.stage || b.status})
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedBatch(b)}
                            className="btn btn-outline btn-sm"
                            style={{ padding: '2px 6px', fontSize: '0.72rem', minHeight: '24px' }}
                          >
                            Inspect
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Primary Active Batch Display (when baker is BUSY) */}
                {activeBatch && !isConflict && (() => {
                  const startTime = activeBatch.actualStartTime || activeBatch.startTime;
                  const elapsedLive = calculateElapsedTime(startTime, now);
                  const rem = calculateRemainingTime(
                    startTime,
                    activeBatch.estimatedDurationMinutes,
                    now
                  );

                  return (
                    <div
                      style={{
                        background: 'var(--bg-main, #fbf9f6)',
                        border: '1px solid var(--border-subtle, #f5f2ed)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.9rem',
                        fontSize: '0.83rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.55rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Current Batch:</span>
                        <strong style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>
                          {activeBatch.batchNumber}
                        </strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Product:</span>
                        <strong style={{ color: 'var(--text-main)' }}>
                          {activeBatch.productName}
                          {activeBatch.variantName ? ` (${activeBatch.variantName})` : ''}
                        </strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Stage / Task:</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            className={`badge ${
                              activeBatch.stage === 'PACKAGING' ? 'badge-info' : 'badge-warning'
                            }`}
                            style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                          >
                            {activeBatch.stage || activeBatch.status}
                          </span>
                          <span style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.78rem' }}>
                            ({activeBatch.task || 'Production'})
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Started At:</span>
                        <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                          {formatTimeOnly(startTime)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Elapsed Time:</span>
                        <span
                          style={{
                            color: 'var(--primary)',
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {elapsedLive}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Estimated Remaining:</span>
                        <span
                          style={{
                            color: rem.isOverdue ? 'var(--danger)' : 'var(--text-main)',
                            fontWeight: 700,
                          }}
                        >
                          {rem.formattedRemaining}
                        </span>
                      </div>

                      {/* Concurrency Policy Explanatory Note */}
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '6px 8px',
                          background: 'rgba(234, 88, 12, 0.08)',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          color: 'var(--primary-dark)',
                          lineHeight: 1.35,
                        }}
                      >
                        Baker occupied with active task. Single-batch concurrency policy prevents assigning new batches until this batch completes.
                      </div>

                      {/* Action Button */}
                      <button
                        type="button"
                        onClick={() => setSelectedBatch(activeBatch)}
                        className="btn btn-outline btn-sm"
                        style={{
                          marginTop: '4px',
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          fontSize: '0.8rem',
                          minHeight: '34px',
                        }}
                      >
                        <Eye size={14} /> Open Batch Details
                      </button>
                    </div>
                  );
                })()}

                {/* Available Status Body */}
                {isAvailable && (
                  <div
                    style={{
                      background: 'var(--bg-main, #fbf9f6)',
                      border: '1px solid var(--border-subtle, #f5f2ed)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.85rem',
                      fontSize: '0.82rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success)' }}>
                      <CheckCircle2 size={16} />
                      <strong style={{ fontSize: '0.86rem' }}>Eligible for Work</strong>
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      0 active batches running. Baker is fully ready to take new verified baking tasks.
                    </p>
                    {item.totalAssigned > 0 && (
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '4px 8px',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                          color: '#166534',
                        }}
                      >
                        Pending queue: <strong>{item.totalAssigned} batch(es)</strong> awaiting kitchen start
                      </div>
                    )}
                  </div>
                )}

                {/* Offline / Inactive Status Body */}
                {isOffline && (
                  <div
                    style={{
                      background: '#f5f5f4',
                      border: '1px solid #e7e5e4',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.85rem',
                      fontSize: '0.82rem',
                      color: '#78716c',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <UserX size={16} />
                      <strong style={{ fontSize: '0.86rem' }}>Account Inactive</strong>
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.4 }}>
                      Staff profile is deactivated. Worker cannot be assigned to batches and does not count towards available kitchen capacity.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Batch Details Modal */}
      {selectedBatch && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--modal-overlay, rgba(28, 25, 23, 0.65))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={() => setSelectedBatch(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-modal-title"
        >
          <div
            className="modal-content card"
            style={{
              maxWidth: '520px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.75rem',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--card-bg)',
              position: 'relative',
              boxShadow: 'var(--shadow-xl)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedBatch(null)}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
              }}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
              <Package size={22} color="var(--primary)" />
              <h3 id="batch-modal-title" style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
                {selectedBatch.batchNumber}
              </h3>
              <span
                className={`badge ${
                  selectedBatch.stage === 'PACKAGING' ? 'badge-info' : 'badge-warning'
                }`}
                style={{ fontSize: '0.74rem' }}
              >
                {selectedBatch.stage || selectedBatch.status}
              </span>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '1.25rem' }}>
              Kitchen production batch details and timing specifications.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                marginBottom: '1.25rem',
                fontSize: '0.84rem',
              }}
            >
              <div style={{ background: 'var(--bg-main, #fbf9f6)', padding: '0.75rem', borderRadius: '8px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Product</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.92rem' }}>{selectedBatch.productName}</strong>
                {selectedBatch.variantName && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block' }}>
                    Variant: {selectedBatch.variantName}
                  </span>
                )}
              </div>

              <div style={{ background: 'var(--bg-main, #fbf9f6)', padding: '0.75rem', borderRadius: '8px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Planned Output</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.92rem' }}>
                  {selectedBatch.plannedQuantity} units
                </strong>
                {selectedBatch.usableQuantity != null && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--success)', display: 'block' }}>
                    Usable: {selectedBatch.usableQuantity} units
                  </span>
                )}
              </div>

              <div style={{ background: 'var(--bg-main, #fbf9f6)', padding: '0.75rem', borderRadius: '8px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Start Timestamp</span>
                <strong style={{ color: 'var(--text-main)' }}>
                  {formatTimeOnly(selectedBatch.actualStartTime || selectedBatch.startTime)}
                </strong>
              </div>

              <div style={{ background: 'var(--bg-main, #fbf9f6)', padding: '0.75rem', borderRadius: '8px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>Assigned Task</span>
                <strong style={{ color: 'var(--primary)' }}>
                  {selectedBatch.task || 'Production Baker'}
                </strong>
              </div>
            </div>

            {/* Timing Progress Bar */}
            <div
              style={{
                background: 'var(--bg-main, #fbf9f6)',
                padding: '0.85rem',
                borderRadius: '8px',
                marginBottom: '1.25rem',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span>Elapsed Duration: <strong>{calculateElapsedTime(selectedBatch.actualStartTime || selectedBatch.startTime, now)}</strong></span>
                <span>Est: <strong>{selectedBatch.estimatedDurationMinutes || 45}m</strong></span>
              </div>
              <div
                style={{
                  height: '8px',
                  borderRadius: '9999px',
                  background: '#e2e8f0',
                  overflow: 'hidden',
                }}
              >
                {(() => {
                  const estMs = (selectedBatch.estimatedDurationMinutes || 45) * 60 * 1000;
                  const startMs = new Date(selectedBatch.actualStartTime || selectedBatch.startTime).getTime();
                  const elapsedMs = Math.max(0, now - startMs);
                  const pct = Math.min(100, Math.round((elapsedMs / estMs) * 100));
                  return (
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: pct >= 100 ? 'var(--danger, #b91c1c)' : 'var(--primary, #ea580c)',
                        transition: 'width 0.5s ease',
                      }}
                    ></div>
                  );
                })()}
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="btn btn-outline btn-sm"
              >
                Close
              </button>
              {onNavigateToProduction && (
                <button
                  type="button"
                  onClick={() => {
                    const batchId = selectedBatch._id || selectedBatch.batchId;
                    setSelectedBatch(null);
                    onNavigateToProduction(batchId);
                  }}
                  className="btn btn-primary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>Open in Production Queue</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
