import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import {
  ShoppingBag,
  ArrowRight,
  Trash2,
  Plus,
  Minus,
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import CatalogImage from '../../components/CatalogImage';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';
import PriceSummary from '../../components/PriceSummary';
import { formatCurrency } from '../../utils/currency';

export default function CartPage() {
  const { items, totalAmount, updateQuantity, removeItem, clearCart, loading } = useCart();
  const { info } = useToast();
  const navigate = useNavigate();
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const hasUnavailableItems = items.some((item) => item.available === false);

  const handleItemRemove = async (itemId, itemName) => {
    if (removingIds.has(itemId)) return;
    setRemovingIds((prev) => new Set(prev).add(itemId));
    // Allow exit animation to complete smoothly before deleting from state
    setTimeout(async () => {
      try {
        await removeItem(itemId);
        info(`Removed ${itemName || 'item'} from basket`);
      } finally {
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    }, 260);
  };

  const handleClearCart = async () => {
    await clearCart();
    info('Basket cleared');
  };

  if (!items || items.length === 0) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem 6rem 1.5rem', maxWidth: '640px' }}>
        <EmptyState
          icon={ShoppingBag}
          title="Your Bakery Basket is Empty"
          description="You haven't selected any artisanal breads or fresh pastries yet. Explore our kitchen's fresh daily menu."
          actionLabel="Browse Fresh Menu"
          actionLink="/"
        />
      </div>
    );
  }

  return (
    <div className="container cart-page" style={{ padding: '2.5rem 1.5rem 5rem 1.5rem', maxWidth: '1080px' }}>
      <PageHeader
        backTo="/"
        backLabel="Continue Shopping"
        title="Your Bakery Basket"
        subtitle="Review fresh selections before seamless guest checkout"
        actions={
          <button
            type="button"
            onClick={handleClearCart}
            disabled={loading}
            className="btn btn-outline btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--danger)',
              borderColor: 'var(--border-color)',
            }}
          >
            <Trash2 size={15} />
            <span>Clear Basket</span>
          </button>
        }
      />

      {hasUnavailableItems && (
        <div className="alert alert-warning" role="alert" style={{ marginBottom: '1.5rem' }}>
          <AlertTriangle size={18} />
          <span>Some items in your basket are currently out of stock. Please remove them before checkout.</span>
        </div>
      )}

      <div className="cart-grid">
        {/* Left Column: Cart Items List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                Items ({items.length})
              </span>
              <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Fresh small-batch bakes
              </span>
            </div>

            {items.map((item) => {
              const prod = item.product || {};
              const variantName =
                item.variant?.name ||
                (item.variant && typeof item.variant === 'string' ? item.variant : null);
              const itemPrice = item.unitPrice ?? item.price ?? 0;
              const itemSubtotal = item.lineTotal ?? (itemPrice * (item.quantity || 1));
              const isUnavailable = item.available === false;

              return (
                <div
                  key={item._id}
                  className={`cart-item-row ${removingIds.has(item._id) ? 'removing' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.25rem',
                    paddingBottom: '1.25rem',
                    borderBottom: '1px solid var(--border-color)',
                    opacity: isUnavailable ? 0.6 : 1,
                    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {/* Item Image Thumbnail */}
                  <div
                    className="cart-item-thumb"
                    style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '12px',
                      backgroundColor: 'var(--primary-light)',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <CatalogImage
                      compact
                      src={prod.imageUrl || prod.images?.[0] || prod.image}
                      alt={prod.name}
                    />
                  </div>

                  {/* Details */}
                  <div className="cart-item-details" style={{ flex: 1, minWidth: 0 }}>
                    <h4
                      style={{
                        margin: '0 0 4px 0',
                        fontSize: '1.05rem',
                        fontWeight: 700,
                        color: 'var(--text-main)',
                      }}
                    >
                      {prod.name || 'Bakery Item'}
                    </h4>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {variantName && (
                        <span className="badge badge-info" style={{ fontSize: '0.72rem' }}>
                          {variantName}
                        </span>
                      )}
                      <span style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                        {formatCurrency(itemPrice)} each
                      </span>
                    </div>

                    {isUnavailable && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600, display: 'block', marginTop: '4px' }}>
                        Item sold out
                      </span>
                    )}
                  </div>

                  {/* Quantity Stepper */}
                  <div
                    className="cart-item-quantity"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      border: '1.5px solid var(--border-color)',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--card-bg)',
                      overflow: 'hidden',
                      height: '34px',
                    }}
                  >
                    <button
                      type="button"
                      disabled={loading || removingIds.has(item._id)}
                      onClick={() => {
                        if (item.quantity <= 1) {
                          handleItemRemove(item._id, prod.name);
                        } else {
                          updateQuantity(item._id, item.quantity - 1);
                        }
                      }}
                      style={{
                        width: '32px',
                        height: '100%',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--text-main)',
                      }}
                      title="Decrease quantity"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={13} />
                    </button>

                    <span
                      style={{
                        padding: '0 8px',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        minWidth: '28px',
                        textAlign: 'center',
                        color: 'var(--text-main)',
                      }}
                    >
                      {item.quantity}
                    </span>

                    <button
                      type="button"
                      disabled={loading || isUnavailable || item.quantity >= 100 || removingIds.has(item._id)}
                      onClick={() => updateQuantity(item._id, item.quantity + 1)}
                      style={{
                        width: '32px',
                        height: '100%',
                        border: 'none',
                        background: 'transparent',
                        cursor: (loading || isUnavailable || removingIds.has(item._id)) ? 'not-allowed' : 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--text-main)',
                      }}
                      title="Increase quantity"
                      aria-label="Increase quantity"
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  {/* Subtotal and Remove */}
                  <div className="cart-item-total" style={{ textAlign: 'right', minWidth: '75px' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>
                      {formatCurrency(itemSubtotal)}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleItemRemove(item._id, prod.name)}
                      disabled={loading || removingIds.has(item._id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '6px 8px',
                        minHeight: '34px',
                        minWidth: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '4px',
                        marginTop: '2px',
                        borderRadius: '6px',
                        transition: 'all 0.15s ease',
                      }}
                      title="Remove from basket"
                      aria-label="Remove item"
                    >
                      <Trash2 size={14} />
                      <span style={{ fontSize: '0.78rem' }}>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}

            <div style={{ paddingTop: '0.5rem' }}>
              <Link
                to="/"
                style={{
                  color: 'var(--primary)',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                }}
              >
                <ArrowLeft size={16} /> Add more bakery items
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column: Order Summary & Checkout Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <PriceSummary
            subtotal={totalAmount}
            packagingFee={0}
            total={totalAmount}
            showUpiNotice={true}
          />

          <div className="card" style={{ padding: '1.25rem', backgroundColor: 'var(--success-light)', borderColor: 'var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontWeight: 700, fontSize: '0.88rem', marginBottom: '4px' }}>
              <ShieldCheck size={18} />
              <span>Direct Guest Checkout</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.45' }}>
              No mandatory account creation. Place order, choose pickup or delivery, and pay using your favorite UPI app.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/checkout')}
            disabled={loading || hasUnavailableItems}
            className="btn btn-primary btn-lg"
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '10px',
              padding: '0.95rem 1.5rem',
            }}
          >
            <span>Proceed to Checkout</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
