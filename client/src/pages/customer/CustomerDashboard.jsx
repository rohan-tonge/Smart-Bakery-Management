import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api/client';
import {
  ShoppingBag,
  QrCode,
  Search,
  AlertCircle,
  User,
  RotateCcw,
  Calendar,
  Croissant,
} from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import EmptyState from '../../components/EmptyState';
import { formatCurrency } from '../../utils/currency';

export default function CustomerDashboard() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const { success, error: toastError } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reordering, setReordering] = useState({});

  useEffect(() => {
    async function fetchOrders() {
      try {
        setLoading(true);
        setError(null);
        const res = await api.getMyOrders();
        const ords = res.data?.orders || res.data || [];
        setOrders(ords);
      } catch (err) {
        setError(err.message || 'Failed to load your orders.');
      } finally {
        setLoading(false);
      }
    }
    fetchOrders();
  }, []);

  const handleReorder = async (order) => {
    if (!order.items || order.items.length === 0) return;
    setReordering((prev) => ({ ...prev, [order._id]: true }));
    try {
      for (const item of order.items) {
        const prodId = item.product?._id || item.product;
        const varId = item.variant?._id || item.variant || item.variantId;
        if (prodId && varId) {
          await addToCart({
            productId: prodId,
            variantId: varId,
            quantity: item.quantity || 1,
          });
        }
      }
      success('Items from this order added to your basket!');
    } catch (err) {
      toastError(`Could not reorder all items: ${err.message}`);
    } finally {
      setReordering((prev) => ({ ...prev, [order._id]: false }));
    }
  };

  return (
    <div className="container customer-dashboard-page" style={{ padding: '2.5rem 1.5rem 5rem 1.5rem', maxWidth: '1020px' }}>
      {/* Profile Header */}
      <div
        className="card"
        style={{
          padding: '2rem',
          marginBottom: '2.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1.5rem',
          background: 'linear-gradient(135deg, #ffffff 0%, var(--bg-main) 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <User size={26} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                {user?.name || 'Customer'}
              </h1>
              <span className="badge badge-info">Verified Account</span>
            </div>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 0', fontSize: '0.9rem' }}>
              {user?.email} {user?.phone ? `· ${user.phone}` : ''}
            </p>
          </div>
        </div>

        <div>
          <Link to="/" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingBag size={18} />
            <span>Order Fresh Items</span>
          </Link>
        </div>
      </div>

      {/* Orders Heading */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
            Your Order History
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '2px 0 0 0' }}>
            Track active deliveries and review previous bakery purchases
          </p>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading ? (
        <LoadingSkeleton type="card" count={3} />
      ) : error ? (
        <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={20} />
          <div>{error}</div>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Croissant}
          title="No orders placed yet"
          description="You haven't ordered any artisanal bakes or pastries yet. Check out our fresh oven selection today!"
          actionLabel="Explore Fresh Menu"
          actionLink="/"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {orders.map((order, idx) => {
            const isUnpaid =
              order.paymentMethod === 'MANUAL_UPI' &&
              order.paymentStatus !== 'PAYMENT_CONFIRMED' &&
              order.paymentStatus !== 'SUCCESS';

            return (
              <div key={order._id} className={`card metric-card-animate stagger-${idx % 12}`} style={{ padding: '1.5rem' }}>
                {/* Header row */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '1rem',
                    paddingBottom: '1rem',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--text-main)' }}>
                        {order.orderNumber}
                      </span>
                      <span className="badge badge-info">{order.orderType}</span>
                    </div>

                    <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Calendar size={14} />
                      <span>
                        Placed on {new Date(order.createdAt).toLocaleDateString()} at{' '}
                        {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <StatusBadge status={order.status} />
                    <StatusBadge status={order.paymentStatus} />
                  </div>
                </div>

                {/* Items list */}
                <div style={{ padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {(order.items || []).map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        color: 'var(--text-main)',
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600 }}>{item.productName || item.product?.name || 'Bakery Item'}</span>
                        {item.variantName && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '6px' }}>
                            ({item.variantName})
                          </span>
                        )}
                        <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>× {item.quantity}</span>
                      </div>
                      <span style={{ fontWeight: 700 }}>
                        {formatCurrency(item.subtotal || (item.unitPrice || item.price || 0) * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Footer with totals and action buttons */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '1rem',
                    borderTop: '1px solid var(--border-color)',
                    flexWrap: 'wrap',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>
                      Order Total
                    </span>
                    <strong style={{ fontSize: '1.25rem', color: 'var(--primary)', fontWeight: 800 }}>
                      {formatCurrency(order.pricing?.total ?? order.totalAmount ?? 0)}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                    {isUnpaid && (
                      <Link
                        to={`/payment-upi/${order._id}?orderNumber=${order.orderNumber}`}
                        className="btn btn-primary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <QrCode size={15} />
                        <span>Pay via UPI</span>
                      </Link>
                    )}

                    <Link
                      to={`/track?orderNumber=${order.orderNumber}`}
                      className="btn btn-outline btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Search size={15} />
                      <span>Track Order</span>
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleReorder(order)}
                      disabled={reordering[order._id]}
                      className="btn btn-outline btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RotateCcw size={15} />
                      <span>{reordering[order._id] ? 'Reordering...' : 'Reorder'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
