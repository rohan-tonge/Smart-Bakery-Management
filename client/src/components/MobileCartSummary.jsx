import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { formatCurrency } from '../utils/currency';

export default function MobileCartSummary() {
  const { itemCount, totalAmount } = useCart();
  const location = useLocation();

  // Don't show the floating cart button if already on cart or checkout pages
  if (!itemCount || location.pathname === '/cart' || location.pathname === '/checkout' || location.pathname.startsWith('/payment-upi')) {
    return null;
  }

  return (
    <div className="mobile-cart-summary" role="region" aria-label="Quick cart bar">
      <Link to="/cart" className="mobile-cart-summary-link">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.25)',
              padding: '4px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.8rem',
              fontWeight: 800,
            }}
          >
            <ShoppingBag size={14} />
            {itemCount}
          </span>
          <span style={{ fontWeight: 700, fontSize: '0.94rem' }}>
            {formatCurrency(totalAmount)}
          </span>
        </span>
        <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.92rem' }}>
          <span>View Basket</span>
          <ArrowRight size={16} />
        </strong>
      </Link>
    </div>
  );
}
