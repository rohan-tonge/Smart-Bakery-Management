import React, { useState, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';

export default function ProductQuantityControl({ productId, variantId, available = true, size = 'md' }) {
  const { items, loading, addToCart, updateQuantity } = useCart();
  const { success } = useToast();
  const [working, setWorking] = useState(false);
  const [popping, setPopping] = useState(false);
  const line = items.find(
    (item) =>
      String(item.product?._id || item.product) === String(productId) &&
      String(item.variant?._id || item.variant) === String(variantId)
  );
  const quantity = line?.quantity || 0;
  const prevQuantityRef = useRef(quantity);
  const busy = loading || working;

  useEffect(() => {
    if (quantity !== prevQuantityRef.current) {
      prevQuantityRef.current = quantity;
      setPopping(true);
      const timer = setTimeout(() => setPopping(false), 240);
      return () => clearTimeout(timer);
    }
  }, [quantity]);

  const change = async (nextQuantity) => {
    if (busy || (!line && !available) || !variantId) return;
    setWorking(true);
    try {
      if (!line) {
        await addToCart({ productId, variantId, quantity: 1 });
        success('Added item to your bakery basket!');
      } else {
        await updateQuantity(line._id, nextQuantity);
      }
    } catch (error) {
      window.alert(`Could not update basket: ${error.message}`);
    } finally {
      setWorking(false);
    }
  };

  const isSmall = size === 'sm';

  if (!quantity) {
    return (
      <button
        type="button"
        className="product-add-button"
        onClick={() => change(1)}
        disabled={busy || !available || !variantId}
        aria-label="Add to basket"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
          padding: isSmall ? '5px 12px' : '7px 16px',
          fontSize: isSmall ? '0.82rem' : '0.88rem',
          fontWeight: 700,
          borderRadius: '9999px',
          border: '1.5px solid var(--primary)',
          backgroundColor: 'var(--card-bg)',
          color: 'var(--primary)',
          cursor: busy || !available ? 'not-allowed' : 'pointer',
          opacity: busy || !available ? 0.6 : 1,
          boxShadow: '0 2px 4px rgba(234, 88, 12, 0.1)',
          transition: 'all 0.15s ease',
          minWidth: isSmall ? '74px' : '88px',
          height: isSmall ? '32px' : '38px',
        }}
      >
        <Plus size={isSmall ? 14 : 16} strokeWidth={2.5} />
        <span>ADD</span>
      </button>
    );
  }

  return (
    <div
      className="quantity-control-pill"
      aria-label={`Quantity ${quantity}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '9999px',
        border: '1.5px solid var(--primary)',
        backgroundColor: 'var(--primary)',
        color: '#ffffff',
        overflow: 'hidden',
        boxShadow: '0 2px 6px rgba(234, 88, 12, 0.25)',
        height: isSmall ? '32px' : '38px',
      }}
    >
      <button
        type="button"
        onClick={() => change(quantity - 1)}
        disabled={busy}
        aria-label="Decrease quantity"
        style={{
          width: isSmall ? '28px' : '34px',
          height: '100%',
          display: 'inline-grid',
          placeItems: 'center',
          backgroundColor: 'transparent',
          color: '#ffffff',
          border: 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.1s ease',
        }}
      >
        <Minus size={isSmall ? 13 : 15} strokeWidth={2.5} />
      </button>

      <output
        aria-live="polite"
        className={popping ? 'qty-pop' : ''}
        style={{
          minWidth: isSmall ? '24px' : '28px',
          textAlign: 'center',
          fontSize: isSmall ? '0.84rem' : '0.92rem',
          fontWeight: 800,
          color: '#ffffff',
          userSelect: 'none',
          display: 'inline-block',
        }}
      >
        {quantity}
      </output>

      <button
        type="button"
        onClick={() => change(quantity + 1)}
        disabled={busy || !available || quantity >= 100}
        aria-label="Increase quantity"
        style={{
          width: isSmall ? '28px' : '34px',
          height: '100%',
          display: 'inline-grid',
          placeItems: 'center',
          backgroundColor: 'transparent',
          color: '#ffffff',
          border: 'none',
          cursor: (busy || !available || quantity >= 100) ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.1s ease',
        }}
      >
        <Plus size={isSmall ? 13 : 15} strokeWidth={2.5} />
      </button>
    </div>
  );
}
