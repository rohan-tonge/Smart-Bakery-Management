import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Image as ImageIcon,
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { formatCurrency } from '../utils/currency';

export default function PaymentProofModal({
  order,
  proofData,
  loading,
  error,
  inventoryCheck,
  onClose,
  onConfirmPayment,
  onRejectPayment,
  onCancelOrder,
  onReviewInventory,
}) {
  const [imgError, setImgError] = useState(false);
  const closeButtonRef = useRef(null);

  // Prevent background scrolling without causing layout jitter or scroll jumps
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollBarWidth > 0) {
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }
    document.body.style.overflow = 'hidden';

    // Focus close button accessibly without scrolling the page
    if (closeButtonRef.current) {
      closeButtonRef.current.focus({ preventScroll: true });
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!order || typeof document === 'undefined') return null;

  const isPendingUpi = order.paymentStatus === 'PENDING_VERIFICATION';
  const orderAmount = order.total ?? order.pricing?.total ?? 0;
  const isDeleted = proofData?.isDeleted || order.paymentProof?.isDeleted;
  const deletedAt = proofData?.deletedAt || order.paymentProof?.deletedAt;
  const uploadedAt = proofData?.uploadedAt || order.paymentProof?.uploadedAt;
  const fileSize = proofData?.fileSize || order.paymentProof?.fileSize;
  const mimeType = proofData?.mimeType || order.paymentProof?.mimeType;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-proof-modal-title"
      className="modal-backdrop-animated"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="card modal-card-animated"
        style={{
          maxWidth: '560px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
          borderRadius: '16px',
          backgroundColor: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border-color)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              id="payment-proof-modal-title"
              style={{
                fontSize: '1.2rem',
                fontWeight: 800,
                margin: 0,
                color: 'var(--text-main)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <ImageIcon size={20} color="var(--primary)" />
              UPI Payment Screenshot
            </h2>
            <p
              style={{
                fontSize: '0.82rem',
                color: 'var(--text-muted)',
                margin: '2px 0 0 0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Order #{order.orderNumber} · Customer: {order.contactName || 'Guest'}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="btn btn-outline btn-sm"
            style={{
              padding: '6px',
              borderRadius: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Close payment screenshot modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {loading ? (
            <div
              style={{
                textAlign: 'center',
                padding: '3.5rem 1rem',
                color: 'var(--text-muted)',
              }}
            >
              <div
                className="spinner"
                style={{
                  width: '36px',
                  height: '36px',
                  borderWidth: '3px',
                  margin: '0 auto 1rem auto',
                }}
              />
              <p style={{ fontWeight: 600, fontSize: '0.95rem', margin: 0 }}>
                Retrieving payment screenshot...
              </p>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Fetching securely with owner authorization
              </span>
            </div>
          ) : error ? (
            <div
              className="alert alert-danger"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '1rem',
                borderRadius: '8px',
              }}
            >
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block', marginBottom: '2px' }}>
                  Unable to view payment screenshot
                </strong>
                <span style={{ fontSize: '0.85rem' }}>{error}</span>
              </div>
            </div>
          ) : isDeleted ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                style={{
                  backgroundColor: 'var(--bg-main)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  fontSize: '0.84rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '10px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                    Payable Amount
                  </span>
                  <strong style={{ fontSize: '1.1rem', color: 'var(--primary)' }}>
                    {formatCurrency(orderAmount)}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                    Uploaded At
                  </span>
                  <strong>{uploadedAt ? new Date(uploadedAt).toLocaleString() : 'N/A'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                    Status
                  </span>
                  <span className="badge badge-warning">Purged</span>
                </div>
              </div>

              <div
                className="alert alert-warning"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '1rem',
                  borderRadius: '8px',
                }}
              >
                <Clock size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.86rem', lineHeight: '1.45' }}>
                  <strong>Payment Screenshot Purged:</strong>
                  <br />
                  The screenshot binary was automatically deleted on{' '}
                  {deletedAt ? new Date(deletedAt).toLocaleDateString() : 'schedule completion'} in
                  accordance with the 30-day payment screenshot retention policy. Order records,
                  timestamps, and audit verification history remain permanently preserved.
                </div>
              </div>
            </div>
          ) : proofData?.dataUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Payment Details Metadata Bar */}
              <div
                style={{
                  backgroundColor: 'var(--bg-main)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  fontSize: '0.84rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '10px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                    Payable Amount
                  </span>
                  <strong style={{ fontSize: '1.15rem', color: 'var(--primary)' }}>
                    {formatCurrency(orderAmount)}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                    Upload Timestamp
                  </span>
                  <strong style={{ fontSize: '0.82rem' }}>
                    {uploadedAt ? new Date(uploadedAt).toLocaleString() : 'N/A'}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                    File Details
                  </span>
                  <span style={{ fontSize: '0.82rem' }}>
                    {fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : 'N/A'}{' '}
                    {mimeType ? `(${mimeType.replace('image/', '').toUpperCase()})` : ''}
                  </span>
                </div>
              </div>

              {/* Centered Image Preview Container */}
              <div
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  textAlign: 'center',
                  backgroundColor: '#050505',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '220px',
                  maxHeight: 'min(500px, 48vh)',
                  position: 'relative',
                  padding: '8px',
                }}
              >
                {imgError ? (
                  <div
                    style={{
                      padding: '2rem 1rem',
                      color: '#f87171',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AlertTriangle size={32} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                      Could not render payment proof preview
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>
                      The image binary may be corrupted or in an unsupported format.
                    </span>
                  </div>
                ) : (
                  <img
                    src={proofData.dataUrl}
                    alt={`Payment proof for order ${order.orderNumber}`}
                    onError={() => setImgError(true)}
                    style={{
                      maxWidth: '100%',
                      maxHeight: 'min(480px, 45vh)',
                      objectFit: 'contain',
                      display: 'block',
                      margin: '0 auto',
                      borderRadius: '6px',
                    }}
                  />
                )}
              </div>

              {/* Retention Policy Footer Note */}
              <div
                style={{
                  fontSize: '0.76rem',
                  color: 'var(--text-muted)',
                  backgroundColor: 'rgba(0, 0, 0, 0.03)',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px dashed var(--border-color)',
                  lineHeight: '1.4',
                }}
              >
                <strong>Automated Retention Policy:</strong> Payment proof screenshots are strictly
                kept for 30 days post-upload, then permanently cleared from storage by the scheduled
                cleanup task.
              </div>
            </div>
          ) : (
            <div className="alert alert-info" style={{ padding: '1rem', borderRadius: '8px' }}>
              No image binary attached to this payment proof record.
            </div>
          )}

          {/* Pre-Acceptance Inventory Check Banner inside Modal */}
          {inventoryCheck && (
            <div style={{ marginTop: '1.25rem' }}>
              {inventoryCheck.status === 'AVAILABLE' ? (
                <div
                  style={{
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: '#166534',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <CheckCircle size={18} color="#16a34a" style={{ flexShrink: 0 }} />
                  <div>
                    <strong style={{ fontSize: '0.9rem' }}>Inventory Check: Available</strong>
                    <div style={{ fontSize: '0.82rem', marginTop: '2px', color: '#15803d' }}>
                      All required ingredients and inventory are available for this order.
                    </div>
                  </div>
                </div>
              ) : inventoryCheck.status === 'INSUFFICIENT' ? (
                <div
                  style={{
                    backgroundColor: '#fef2f2',
                    border: '1.5px solid #f87171',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    color: '#991b1b',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0 }} />
                    <strong style={{ fontSize: '0.92rem' }}>Inventory Warning: Insufficient Ingredients</strong>
                  </div>
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.84rem', color: '#7f1d1d' }}>
                    Cannot accept order: one or more required recipe ingredients have insufficient inventory.
                  </p>

                  {inventoryCheck.shortages?.length > 0 && (
                    <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#ffffff', marginBottom: '10px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                          <tr style={{ background: '#fee2e2', borderBottom: '1px solid #fca5a5' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: '#991b1b' }}>Ingredient</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#991b1b' }}>Required</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#991b1b' }}>Available</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#991b1b' }}>Shortage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventoryCheck.shortages.map((s) => (
                            <tr key={s.ingredientId} style={{ borderBottom: '1px solid #fecaca' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600 }}>{s.ingredientName}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{s.required} {s.unit}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right' }}>{s.available} {s.unit}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', color: '#dc2626', fontWeight: 800 }}>{s.shortage} {s.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (onCancelOrder) onCancelOrder(order._id);
                      }}
                      className="btn btn-sm"
                      style={{ backgroundColor: '#dc2626', color: '#ffffff', border: 'none', fontWeight: 700 }}
                    >
                      Cancel Order
                    </button>
                    {onReviewInventory && (
                      <button
                        type="button"
                        onClick={onReviewInventory}
                        className="btn btn-outline btn-sm"
                        style={{ borderColor: '#991b1b', color: '#991b1b' }}
                      >
                        Review Inventory
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            flexWrap: 'wrap',
            backgroundColor: 'var(--bg-main, #fafafa)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline btn-sm"
            style={{ minWidth: '80px' }}
          >
            Close
          </button>
          {isPendingUpi && (() => {
            const isInsufficient = inventoryCheck?.status === 'INSUFFICIENT';

            return (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    const id = order._id;
                    onClose();
                    if (onRejectPayment) await onRejectPayment(id);
                  }}
                  className="btn btn-outline btn-sm"
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                >
                  Reject & Cancel Order
                </button>
                <button
                  type="button"
                  disabled={isInsufficient}
                  onClick={async () => {
                    const id = order._id;
                    onClose();
                    if (onConfirmPayment) await onConfirmPayment(id);
                  }}
                  className="btn btn-primary btn-sm"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: isInsufficient ? 0.5 : 1,
                    cursor: isInsufficient ? 'not-allowed' : 'pointer',
                  }}
                  title={isInsufficient ? 'Order acceptance blocked: Insufficient inventory' : 'Approve & Verify Payment'}
                >
                  <CheckCircle size={15} /> Approve & Verify Payment
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>,
    document.body
  );
}
