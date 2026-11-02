import React from 'react';
import { QrCode } from 'lucide-react';
import { formatCurrency } from '../utils/currency';

export default function PriceSummary({
  subtotal = 0,
  deliveryFee = 0,
  packagingFee = 0,
  total,
  orderType = 'PICKUP',
  showUpiNotice = true,
  className = '',
}) {
  const calculatedTotal = total ?? (Number(subtotal) + Number(deliveryFee) + Number(packagingFee));

  return (
    <div
      className={`price-summary-card ${className}`}
      style={{
        backgroundColor: 'var(--card-bg)',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <h3
        style={{
          fontSize: '1.15rem',
          fontWeight: 700,
          marginBottom: '1.25rem',
          color: 'var(--text-main)',
        }}
      >
        Bill Details
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.92rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
          <span>Item Total</span>
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatCurrency(subtotal)}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
          <span>Eco Kitchen Packaging</span>
          <span style={{ fontWeight: 600, color: '#16a34a' }}>
            {packagingFee > 0 ? formatCurrency(packagingFee) : 'Free'}
          </span>
        </div>

        {orderType === 'DELIVERY' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span>Delivery Partner Fee</span>
            <span style={{ fontWeight: 600, color: deliveryFee > 0 ? 'var(--text-main)' : '#16a34a' }}>
              {deliveryFee > 0 ? formatCurrency(deliveryFee) : 'Free'}
            </span>
          </div>
        )}

        <div style={{ borderTop: '1px dashed var(--border-color)', margin: '0.4rem 0' }} />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingTop: '0.25rem',
          }}
        >
          <div>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', display: 'block' }}>
              To Pay
            </span>
            <small style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Inclusive of all taxes</small>
          </div>
          <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--primary)' }}>
            {formatCurrency(calculatedTotal)}
          </span>
        </div>
      </div>

      {showUpiNotice && (
        <div
          style={{
            marginTop: '1.25rem',
            padding: '10px 12px',
            backgroundColor: 'var(--primary-light)',
            borderRadius: '10px',
            border: '1px solid var(--primary-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.82rem',
            color: 'var(--primary-dark)',
          }}
        >
          <QrCode size={16} color="var(--primary)" style={{ flexShrink: 0 }} />
          <span>Pay via Bakery UPI QR with zero platform surcharge</span>
        </div>
      )}
    </div>
  );
}
