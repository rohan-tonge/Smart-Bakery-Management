import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import {
  Search,
  CheckCircle2,
  Clock,
  ChefHat,
  Package,
  Check,
  AlertCircle,
  QrCode,
  MapPin,
  Calendar,
} from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import PageHeader from '../../components/PageHeader';
import { formatCurrency } from '../../utils/currency';

export default function OrderTrackingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialOrderNumber = searchParams.get('orderNumber') || '';
  const initialPhone = searchParams.get('phone') || '';
  const initialToken = searchParams.get('token') || '';

  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState(initialPhone);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const performTrack = async (searchNum, searchPhone, tokenVal) => {
    if (!searchNum) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('You are currently offline. A live internet connection is required to track real-time order status.');
      setOrder(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await api.trackOrder({
        orderNumber: searchNum.trim(),
        phone: searchPhone?.trim() || undefined,
        token: tokenVal || undefined,
      });
      const ord = res.data?.order || res.data;
      setOrder(ord);
    } catch (err) {
      setError(err.message || 'Order not found. Please verify the order number and contact phone number.');
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialOrderNumber) {
      performTrack(initialOrderNumber, initialPhone, initialToken);
    }
  }, [initialOrderNumber, initialPhone, initialToken]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!orderNumber.trim()) return;
    setSearchParams({
      orderNumber: orderNumber.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(initialToken ? { token: initialToken } : {}),
    });
    performTrack(orderNumber.trim(), phone.trim(), initialToken);
  };

  // Helper for Stepper Stage
  const getStepStatus = (status, stageIndex) => {
    const map = {
      PENDING: 0,
      PENDING_PAYMENT: 0,
      CONFIRMED: 1,
      IN_PRODUCTION: 2,
      READY: 3,
      OUT_FOR_DELIVERY: 3,
      DELIVERED: 4,
      COMPLETED: 4,
    };

    const currentLevel = map[status] ?? 0;
    if (currentLevel > stageIndex) return 'completed';
    if (currentLevel === stageIndex) return 'current';
    return 'upcoming';
  };

  const steps = [
    { label: 'Order Placed', icon: Clock, desc: 'Received in system' },
    { label: 'Payment Verified', icon: CheckCircle2, desc: 'Confirmed by bakery' },
    { label: 'In Kitchen Oven', icon: ChefHat, desc: 'Baking & preparation' },
    { label: 'Packed & Ready', icon: Package, desc: 'Freshly packed & ready' },
    { label: 'Delivered / Completed', icon: Check, desc: 'Ready for you' },
  ];

  return (
    <div className="container tracking-page" style={{ padding: '2.5rem 1.5rem 5rem 1.5rem', maxWidth: '880px' }}>
      <PageHeader
        backTo="/"
        backLabel="Back to Menu"
        title="Live Order Tracking"
        subtitle="Track preparation, kitchen baking, and delivery updates in real-time"
      />

      {/* Search Bar Form */}
      <div className="card" style={{ padding: '1.75rem', marginBottom: '2rem' }}>
        <form
          onSubmit={handleSearchSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr)) auto',
            gap: '1rem',
            alignItems: 'flex-end',
          }}
        >
          <div>
            <label
              htmlFor="track-ord-num"
              style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}
            >
              Order Number <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              id="track-ord-num"
              type="text"
              required
              className="input-field"
              placeholder="e.g. ORD-20261009-XXXX"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              style={{ margin: 0 }}
            />
          </div>

          <div>
            <label
              htmlFor="track-phone"
              style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}
            >
              Contact Phone (Guest Security)
            </label>
            <input
              id="track-phone"
              type="tel"
              className="input-field"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ margin: 0 }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              height: '44px',
              padding: '0 1.5rem',
            }}
          >
            {loading ? <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> : <Search size={18} />}
            <span>Track Order</span>
          </button>
        </form>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2rem' }}>
          <AlertCircle size={20} />
          <div>{error}</div>
        </div>
      )}

      {/* Order Details Display */}
      {order && (
        <div className="card" style={{ padding: '2rem' }}>
          {/* Top Order Strip */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '1rem',
              paddingBottom: '1.5rem',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  {order.orderNumber}
                </h2>
                <span className="badge badge-info">{order.orderType}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                <Calendar size={14} />
                <span>Placed on {new Date(order.createdAt).toLocaleString()}</span>
              </div>
            </div>

            <div>
              <StatusBadge status={order.status} size="lg" />
            </div>
          </div>

          {/* Stepper Progress */}
          <div style={{ padding: '2.5rem 0 2rem 0' }}>
            <div className="order-stepper-grid">
              {steps.map((st, idx) => {
                const state = getStepStatus(order.status, idx);
                const StepIcon = st.icon;
                const isComp = state === 'completed';
                const isCurr = state === 'current';

                return (
                  <div
                    key={idx}
                    className="order-stepper-item"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      position: 'relative',
                    }}
                  >
                    <div
                      className={`stepper-icon-bubble ${isCurr ? 'stepper-step-current' : isComp ? 'stepper-step-completed' : ''}`}
                      style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '10px',
                        backgroundColor: isComp ? '#16a34a' : isCurr ? 'var(--primary)' : 'var(--bg-main)',
                        color: isComp || isCurr ? '#ffffff' : 'var(--text-muted)',
                        border: isCurr ? '2px solid var(--primary-dark)' : '1.5px solid var(--border-color)',
                        boxShadow: isCurr ? '0 4px 12px rgba(234, 88, 12, 0.3)' : 'none',
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      <StepIcon size={22} />
                    </div>
                    <span
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: isCurr ? 800 : isComp ? 700 : 500,
                        color: isCurr ? 'var(--primary)' : isComp ? 'var(--text-main)' : 'var(--text-muted)',
                        lineHeight: 1.25,
                      }}
                    >
                      {st.label}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {st.desc}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment Status Card */}
          <div
            style={{
              backgroundColor: 'var(--bg-main)',
              padding: '1.25rem',
              borderRadius: '14px',
              border: '1px solid var(--border-color)',
              marginBottom: '1.75rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>
                Payment Method & Status
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <strong style={{ fontSize: '0.98rem' }}>{order.paymentMethod}</strong>
                <StatusBadge status={order.paymentStatus} size="sm" />
              </div>
              {order.paymentReference && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Submitted UTR: <strong>{order.paymentReference}</strong>
                </div>
              )}
            </div>

            {/* Prompt for UPI Payment if unpaid */}
            {order.paymentMethod === 'MANUAL_UPI' &&
              ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'CUSTOMER_MARKED_PAID'].includes(order.paymentStatus) && (
                <Link
                  to={`/payment-upi/${order._id}?orderNumber=${order.orderNumber}${
                    initialToken ? `&token=${initialToken}` : ''
                  }`}
                  className="btn btn-primary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <QrCode size={16} />
                  <span>
                    {['PENDING_VERIFICATION', 'CUSTOMER_MARKED_PAID'].includes(order.paymentStatus)
                      ? 'Check Payment Status'
                      : 'Pay via UPI QR Code'}
                  </span>
                </Link>
              )}
          </div>

          {/* Items Breakdown */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-main)' }}>
              Ordered Items
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(order.items || []).map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    backgroundColor: 'var(--card-bg)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.9rem',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                      {item.productName || item.product?.name || 'Bakery Item'}
                    </span>
                    {item.variantName && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '6px' }}>
                        ({item.variantName})
                      </span>
                    )}
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>× {item.quantity}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                    {formatCurrency(item.subtotal || (item.unitPrice || item.price || 0) * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>
                Total: <span style={{ color: 'var(--primary)' }}>{formatCurrency(order.pricing?.total ?? order.totalAmount ?? 0)}</span>
              </div>
            </div>
          </div>

          {/* Delivery Details */}
          {order.orderType === 'DELIVERY' && order.deliveryAddress && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '4px' }}>
                <MapPin size={16} color="var(--primary)" />
                <span>Delivery Address</span>
              </div>
              <p style={{ color: 'var(--text-muted)', margin: 0, paddingLeft: '22px' }}>
                {order.deliveryAddress.addressLine1}
                {order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ''}
                , {order.deliveryAddress.city}, {order.deliveryAddress.postalCode}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
