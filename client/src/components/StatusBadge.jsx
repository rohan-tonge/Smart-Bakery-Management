import React from 'react';

const STATUS_CONFIG = {
  // Order Statuses
  PENDING: { label: 'Order Placed', color: 'warning', bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#f59e0b' },
  PENDING_PAYMENT: { label: 'Pending Payment', color: 'warning', bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#f59e0b' },
  CONFIRMED: { label: 'Confirmed', color: 'info', bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6' },
  IN_PRODUCTION: { label: 'In Kitchen Oven', color: 'info', bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd', dot: '#0ea5e9' },
  READY: { label: 'Ready for Pickup', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  OUT_FOR_DELIVERY: { label: 'Out for Delivery', color: 'info', bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6' },
  DELIVERED: { label: 'Delivered', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  COMPLETED: { label: 'Completed', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  CANCELLED: { label: 'Cancelled', color: 'danger', bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', dot: '#ef4444' },

  // Payment Statuses
  PAYMENT_PENDING: { label: 'Payment Pending', color: 'warning', bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#f59e0b' },
  PENDING_VERIFICATION: { label: 'Under Bakery Review', color: 'warning', bg: '#fff7ed', text: '#c2410c', border: '#ffedd5', dot: '#f97316' },
  CUSTOMER_MARKED_PAID: { label: 'Reference Submitted', color: 'warning', bg: '#fff7ed', text: '#c2410c', border: '#ffedd5', dot: '#f97316' },
  PAYMENT_CONFIRMED: { label: 'Payment Verified', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  SUCCESS: { label: 'Paid', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  PAYMENT_REJECTED: { label: 'Payment Rejected', color: 'danger', bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', dot: '#ef4444' },
  FAILED: { label: 'Payment Failed', color: 'danger', bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', dot: '#ef4444' },

  // Production Batches
  PLANNED: { label: 'Planned', color: 'neutral', bg: '#f5f5f4', text: '#57534e', border: '#e7e5e4', dot: '#a8a29e' },
  ACCEPTED: { label: 'Accepted', color: 'info', bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6' },
  VERIFIED: { label: 'Ingredients Verified', color: 'info', bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd', dot: '#0ea5e9' },
  PACKAGING: { label: 'Packaging', color: 'info', bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff', dot: '#a855f7' },
  PACKAGED: { label: 'Packaged', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  REJECTED: { label: 'Rejected', color: 'danger', bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', dot: '#ef4444' },

  // Stock Statuses
  IN_STOCK: { label: 'In Stock', color: 'success', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  LOW_STOCK: { label: 'Low Stock', color: 'warning', bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#f59e0b' },
  OUT_OF_STOCK: { label: 'Out of Stock', color: 'danger', bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', dot: '#ef4444' },
  EXPIRING: { label: 'Expiring Soon', color: 'danger', bg: '#fff1f2', text: '#be123c', border: '#fecdd3', dot: '#f43f5e' },
};

export default function StatusBadge({ status, customLabel, size = 'md', className = '' }) {
  if (!status) return null;
  const normalizedKey = String(status).toUpperCase().replace(/\s+/g, '_');
  const config = STATUS_CONFIG[normalizedKey] || {
    label: customLabel || status.replace(/_/g, ' '),
    bg: '#f5f5f4',
    text: '#57534e',
    border: '#e7e5e4',
    dot: '#a8a29e',
  };

  const isSmall = size === 'sm';
  const isLarge = size === 'lg';
  const isLive = ['PENDING', 'PENDING_PAYMENT', 'IN_PRODUCTION', 'PENDING_VERIFICATION', 'CUSTOMER_MARKED_PAID', 'OUT_FOR_DELIVERY', 'ACCEPTED', 'PACKAGING'].includes(normalizedKey);

  const badgeStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: isSmall ? '5px' : '7px',
    padding: isSmall ? '2px 8px' : isLarge ? '6px 14px' : '4px 10px',
    fontSize: isSmall ? '0.72rem' : isLarge ? '0.86rem' : '0.78rem',
    fontWeight: 600,
    borderRadius: '9999px',
    backgroundColor: config.bg,
    color: config.text,
    border: `1px solid ${config.border}`,
    letterSpacing: '0.01em',
    lineHeight: 1.25,
    whiteSpace: 'nowrap',
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const dotStyles = {
    width: isSmall ? '6px' : '7px',
    height: isSmall ? '6px' : '7px',
    borderRadius: '50%',
    backgroundColor: config.dot,
    flexShrink: 0,
  };

  return (
    <span style={badgeStyles} className={`status-badge ${isLive ? 'status-badge-live' : ''} ${className}`}>
      <span style={dotStyles} className="status-badge-dot" aria-hidden="true" />
      <span>{customLabel || config.label}</span>
    </span>
  );
}
