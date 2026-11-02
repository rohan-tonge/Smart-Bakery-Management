import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { formatCurrency } from '../utils/currency';
import {
  X,
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Zap,
  Box,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';

export default function BatchCostModal({ batch, onClose, onCostFinalized }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [costData, setCostData] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [showMaterialDetails, setShowMaterialDetails] = useState(false);

  const fetchCostData = useCallback(async () => {
    if (!batch?._id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getBatchCost(batch._id);
      const cost = res.data?.cost || res.data || {};
      setCostData(cost);
    } catch (err) {
      setError(err.message || 'Failed to load batch cost data');
    } finally {
      setLoading(false);
    }
  }, [batch?._id]);

  useEffect(() => {
    fetchCostData();
  }, [fetchCostData]);

  const handleFinalizeCost = async () => {
    if (!batch?._id) return;
    try {
      setFinalizing(true);
      setFeedback(null);
      await api.finalizeBatchCost(batch._id, {});
      setFeedback({
        type: 'success',
        message: 'Production cost snapshot finalized and locked successfully.',
      });
      await fetchCostData();
      if (typeof onCostFinalized === 'function') {
        onCostFinalized();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to finalize batch cost',
      });
    } finally {
      setFinalizing(false);
    }
  };

  // Determine actual finished quantity Q
  const finishedQuantity = (() => {
    if (costData?.actualFinishedQuantity !== undefined && costData?.actualFinishedQuantity !== null) {
      return Number(costData.actualFinishedQuantity);
    }
    if (batch?.usableQuantity !== undefined && batch?.usableQuantity !== null) {
      return Number(batch.usableQuantity);
    }
    if (batch?.packagedQuantity !== undefined && batch?.packagedQuantity !== null) {
      return Number(batch.packagedQuantity);
    }
    if (batch?.producedQuantity !== undefined && batch?.producedQuantity !== null) {
      return Number(batch.producedQuantity);
    }
    if (batch?.plannedQuantity !== undefined && batch?.plannedQuantity !== null) {
      return Number(batch.plannedQuantity);
    }
    return 0;
  })();

  const ingredientCost = Number(costData?.ingredientCost || 0);
  const electricityCost = Number(costData?.electricityCost || 0);
  const packagingCost = Number(costData?.packagingCost || 0);
  const totalCost = Number(costData?.totalCost ?? (ingredientCost + electricityCost + packagingCost));

  // Configured per-unit rates (default missing legacy to 0)
  const electricityPerUnit = Number(costData?.electricityCostPerUnit ?? batch?.productSnapshot?.electricityCostPerUnit ?? 0);
  const packagingPerUnit = Number(costData?.packagingCostPerUnit ?? batch?.productSnapshot?.packagingCostPerUnit ?? 0);

  // Per-unit values
  const hasFinishedQuantity = Number.isFinite(finishedQuantity) && finishedQuantity > 0;
  const costPerUnit = hasFinishedQuantity ? totalCost / finishedQuantity : null;
  const ingredientPerUnit = hasFinishedQuantity ? ingredientCost / finishedQuantity : null;

  const isFinalized = costData?.status === 'FINALIZED' || batch?.costing?.status === 'FINALIZED';
  const hasCostData = Boolean(costData && (ingredientCost > 0 || totalCost > 0 || isFinalized));

  return (
    <div
      className="modal-backdrop-animated"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card modal-card-animated"
        style={{
          maxWidth: '720px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-main)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                Production Cost Breakdown
              </h2>
              {isFinalized ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  <Lock size={11} /> FINALIZED
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: '#e0f2fe',
                    color: '#0369a1',
                    border: '1px solid #bae6fd',
                  }}
                >
                  <Sparkles size={11} /> PREVIEW
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Batch <strong>{batch?.batchNumber}</strong> · {batch?.productSnapshot?.productName || 'Product'} (
              {batch?.productSnapshot?.variantName || 'Variant'})
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={fetchCostData}
              disabled={loading}
              className="btn btn-outline btn-sm"
              style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Refresh cost data"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span className="hide-mobile">Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              style={{ padding: '6px', borderRadius: '8px' }}
              aria-label="Close cost modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Feedback Alerts */}
          {feedback && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2',
                color: feedback.type === 'success' ? '#166534' : '#991b1b',
                border: feedback.type === 'success' ? '1px solid #bbf7d0' : '1px solid #fecaca',
              }}
            >
              {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Loading State */}
          {loading && !costData && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <RefreshCw size={32} className="spin" style={{ margin: '0 auto 12px auto', display: 'block' }} />
              <p style={{ margin: 0, fontWeight: 600 }}>Calculating batch production cost...</p>
            </div>
          )}

          {/* Error State */}
          {error && !costData && (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                backgroundColor: '#fef2f2',
                borderRadius: '12px',
                border: '1px solid #fecaca',
                color: '#991b1b',
              }}
            >
              <AlertCircle size={32} style={{ margin: '0 auto 8px auto', display: 'block' }} />
              <h4 style={{ margin: '0 0 6px 0', fontWeight: 800 }}>Could Not Load Cost Data</h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.88rem' }}>{error}</p>
              <button type="button" onClick={fetchCostData} className="btn btn-sm btn-outline">
                Retry
              </button>
            </div>
          )}

          {/* Empty State when no costs yet calculated */}
          {!loading && !error && !hasCostData && (
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                backgroundColor: 'var(--bg-main)',
                borderRadius: '12px',
                border: '1px dashed var(--border-color)',
                color: 'var(--text-muted)',
              }}
            >
              <Box size={36} style={{ margin: '0 auto 10px auto', display: 'block', opacity: 0.6 }} />
              <h4 style={{ margin: '0 0 6px 0', fontWeight: 700, color: 'var(--text-main)' }}>
                Cost Not Yet Calculated
              </h4>
              <p style={{ margin: 0, fontSize: '0.86rem' }}>
                Batch production costs will be generated automatically once baking ingredients are issued and consumed.
              </p>
            </div>
          )}

          {/* Cost Content */}
          {costData && (
            <>
              {/* PRIMARY HERO CARD: TOTAL PRODUCTION COST */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                  color: '#ffffff',
                  borderRadius: '14px',
                  padding: '1.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1.25rem',
                  boxShadow: '0 10px 20px -5px rgba(15, 23, 42, 0.3)',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 700 }}>
                    Total Production Cost
                  </div>
                  <div style={{ fontSize: '2.4rem', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.15, marginTop: '4px' }}>
                    {formatCurrency(totalCost)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: '6px' }}>
                    Formula: Ingredient Cost + Electricity Cost + Packaging Cost
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '1rem 1.25rem',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    minWidth: '180px',
                    textAlign: 'right',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>
                    Cost Per Unit
                  </div>
                  <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#38bdf8', lineHeight: 1.2, marginTop: '2px' }}>
                    {hasFinishedQuantity && costPerUnit !== null ? (
                      formatCurrency(costPerUnit)
                    ) : (
                      <span style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 500 }}>Not calculated</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#cbd5e1', marginTop: '4px' }}>
                    Finished Qty: <strong>{finishedQuantity}</strong> {finishedQuantity === 1 ? 'unit' : 'units'}
                  </div>
                </div>
              </div>

              {/* THREE COST COMPONENTS (CARDS / ROWS) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' }}>
                {/* 1. Ingredient Cost */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    borderRadius: '12px',
                    padding: '1rem 1.15rem',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)', marginBottom: '4px' }}>
                      <Layers size={16} />
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Ingredient Cost
                      </span>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.2 }}>
                      {formatCurrency(ingredientCost)}
                    </div>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                    <div>
                      Per unit:{' '}
                      <strong style={{ color: 'var(--text-main)' }}>
                        {ingredientPerUnit !== null ? `${formatCurrency(ingredientPerUnit)}` : '—'}
                      </strong>
                    </div>
                    <div style={{ fontSize: '0.72rem', marginTop: '2px' }}>Actual FIFO lot consumption</div>
                  </div>
                </div>

                {/* 2. Electricity Cost */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    borderRadius: '12px',
                    padding: '1rem 1.15rem',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#eab308', marginBottom: '4px' }}>
                      <Zap size={16} />
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                        Electricity Cost
                      </span>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.2 }}>
                      {formatCurrency(electricityCost)}
                    </div>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                    <div>
                      Configured:{' '}
                      <strong style={{ color: 'var(--text-main)' }}>
                        {formatCurrency(electricityPerUnit)} / unit
                      </strong>
                    </div>
                    <div style={{ fontSize: '0.72rem', marginTop: '2px' }}>
                      {hasFinishedQuantity
                        ? `${formatCurrency(electricityPerUnit)} × ${finishedQuantity} finished units`
                        : 'Awaiting finished quantity'}
                    </div>
                  </div>
                </div>

                {/* 3. Packaging Cost */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    borderRadius: '12px',
                    padding: '1rem 1.15rem',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8b5cf6', marginBottom: '4px' }}>
                      <Box size={16} />
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                        Packaging Cost
                      </span>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.2 }}>
                      {formatCurrency(packagingCost)}
                    </div>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
                    <div>
                      Configured:{' '}
                      <strong style={{ color: 'var(--text-main)' }}>
                        {formatCurrency(packagingPerUnit)} / unit
                      </strong>
                    </div>
                    <div style={{ fontSize: '0.72rem', marginTop: '2px' }}>
                      {hasFinishedQuantity
                        ? `${formatCurrency(packagingPerUnit)} × ${finishedQuantity} finished units`
                        : 'Awaiting finished quantity'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Informational Policy Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.82rem',
                  color: '#475569',
                }}
              >
                <Info size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Costing Policy: </strong>
                  Electricity and packaging costs are calculated automatically using the product's configured per-unit
                  values ({formatCurrency(electricityPerUnit)} and {formatCurrency(packagingPerUnit)} per finished unit).
                  No live baker timers, labour hours, or hourly rates are used.
                </div>
              </div>

              {/* Optional Consumed Material Snapshots Table */}
              {Array.isArray(costData.materialSnapshots) && costData.materialSnapshots.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => setShowMaterialDetails(!showMaterialDetails)}
                  >
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      Consumed Ingredients Lot Traceability ({costData.materialSnapshots.length})
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.78rem', color: 'var(--primary)' }}
                    >
                      {showMaterialDetails ? 'Hide Details' : 'View Details'}
                    </button>
                  </div>

                  {showMaterialDetails && (
                    <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '6px 8px' }}>Ingredient</th>
                            <th style={{ padding: '6px 8px' }}>Lot #</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Quantity</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Unit Cost</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costData.materialSnapshots.map((m, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{m.ingredientName}</td>
                              <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                {m.lotNumber || '—'}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                {m.quantity} {m.unit}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                {formatCurrency(m.unitCostSnapshot)}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                                {formatCurrency(m.costPaise ? m.costPaise / 100 : (m.quantity * m.unitCostSnapshot))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-main)',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {isFinalized ? (
              <span>Finalized snapshot is immutable and locked.</span>
            ) : (
              <span>Review calculated values before locking snapshot.</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="button" onClick={onClose} className="btn btn-outline btn-sm">
              Close
            </button>
            {!isFinalized && hasCostData && (
              <button
                type="button"
                onClick={handleFinalizeCost}
                disabled={finalizing}
                className="btn btn-primary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {finalizing ? <RefreshCw size={14} className="spin" /> : <Lock size={14} />}
                <span>Finalize Cost Snapshot</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
