import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { usePwa } from '../../context/PwaContext';
import { api, getGuestId } from '../../api/client';
import { getCartLineTotal } from '../../utils/cartPricing';
import {
  QrCode,
  Truck,
  Store,
  AlertCircle,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  Calendar,
  Clock,
  CheckCircle2,
  Banknote,
  RotateCw,
  UserCheck,
  Package,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import PriceSummary from '../../components/PriceSummary';
import { formatCurrency } from '../../utils/currency';
import { getSavedCustomer, saveCustomerDetails, clearSavedCustomer } from '../../utils/savedCustomer';

export default function CheckoutPage() {
  const { items, totalAmount, clearCart } = useCart();
  const { user } = useAuth();
  const { isOnline } = usePwa();
  const navigate = useNavigate();

  const [orderType, setOrderType] = useState('PICKUP'); // 'PICKUP' or 'DELIVERY'
  const [paymentMethod, setPaymentMethod] = useState('MANUAL_UPI'); // 'MANUAL_UPI' or 'COD'

  // Tomorrow calculation (earliest allowed order date)
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Delivery / Pickup date and time slot state
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsData, setSlotsData] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [conflictAlternatives, setConflictAlternatives] = useState(null);

  // Saved Customer state for browser persistence
  const [savedCustomer, setSavedCustomer] = useState(null);
  const [useSavedDetails, setUseSavedDetails] = useState(false);

  // Contact form
  const [contactName, setContactName] = useState(user?.name || '');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [contactEmail, setContactEmail] = useState(user?.email || '');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [packInstructions, setPackInstructions] = useState('');

  // Delivery Address form
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [checkoutKey] = useState(
    () => globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  // Load saved customer from browser storage on mount
  useEffect(() => {
    const saved = getSavedCustomer();
    if (saved) {
      setSavedCustomer(saved);
      if (!user) {
        setUseSavedDetails(true);
        if (saved.name) setContactName(saved.name);
        if (saved.phone) setContactPhone(saved.phone);
        if (saved.email) setContactEmail(saved.email);
        if (saved.address) {
          if (saved.address.addressLine1) setAddressLine1(saved.address.addressLine1);
          if (saved.address.addressLine2) setAddressLine2(saved.address.addressLine2);
          if (saved.address.city) setCity(saved.address.city);
          if (saved.address.state) setState(saved.address.state);
          if (saved.address.postalCode) setPostalCode(saved.address.postalCode);
        }
      }
    }
  }, [user]);

  // Load available delivery / pickup slots
  useEffect(() => {
    let active = true;
    async function loadSlots() {
      if (!items || items.length === 0) return;
      try {
        setSlotsLoading(true);
        const cartPayload = items.map((i) => ({
          productId: i.productId || i.product?._id || i.product,
          variantId: i.variantId || i.variant?._id || i.variant,
          quantity: i.quantity,
        }));
        const res = await api.getDeliverySlots({
          orderType,
          items: cartPayload,
          guestId: !user ? getGuestId() : undefined,
        });
        if (!active) return;
        const data = res.data || {};
        if (!data.dates && data.days) {
          data.dates = data.days;
        }

        // Strictly enforce next-day onward ordering by filtering out today and past dates
        if (Array.isArray(data?.dates)) {
          data.dates = data.dates.filter((d) => d.date >= tomorrowStr);
        }

        setSlotsData(data);
        if (data?.dates?.length > 0) {
          // Select earliest feasible date with available slots
          const firstFeasibleDate =
            data.dates.find((d) => d.isFeasible && d.slots.some((s) => s.isAvailable)) || data.dates[0];
          setSelectedDate((curr) => {
            const exists = data.dates.some((d) => d.date === curr);
            return exists ? curr : firstFeasibleDate.date;
          });
          const availableSlot = firstFeasibleDate.slots.find((s) => s.isAvailable);
          if (availableSlot) {
            const slotVal = availableSlot.slot || availableSlot.timeSlot;
            setSelectedSlot((curr) => {
              const currentDateObj = data.dates.find((d) => d.date === (curr ? selectedDate : firstFeasibleDate.date));
              const currentSlotObj = currentDateObj?.slots?.find((s) => (s.slot === curr || s.timeSlot === curr) && s.isAvailable);
              return currentSlotObj ? curr : slotVal;
            });
          }
        }
      } catch (err) {
        console.warn('Failed to load slots:', err);
      } finally {
        if (active) setSlotsLoading(false);
      }
    }
    loadSlots();
    return () => {
      active = false;
    };
  }, [orderType, items, user, tomorrowStr]);

  if (!items || items.length === 0) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem', textAlign: 'center', maxWidth: '600px' }}>
        <div className="card" style={{ padding: '3rem 2rem' }}>
          <h2>Your basket is empty</h2>
          <p style={{ color: 'var(--text-muted)', margin: '1rem 0 2rem 0' }}>
            Add some fresh baked items before checking out.
          </p>
          <Link to="/" className="btn btn-primary">
            Browse Menu
          </Link>
        </div>
      </div>
    );
  }

  const handleDateSelect = (dateStr) => {
    if (dateStr < tomorrowStr) {
      setError('Orders must be scheduled at least one day in advance. Select tomorrow or a later date.');
      return;
    }
    setSelectedDate(dateStr);
    setConflictAlternatives(null);
    const dateObj = slotsData?.dates?.find((d) => d.date === dateStr);
    const firstAvail = dateObj?.slots?.find((s) => s.isAvailable);
    if (firstAvail) {
      setSelectedSlot(firstAvail.slot || firstAvail.timeSlot);
    } else {
      setSelectedSlot('');
    }
  };

  const handleApplyAlternativeSlot = (altDate, altSlot) => {
    setSelectedDate(altDate);
    setSelectedSlot(altSlot);
    setConflictAlternatives(null);
    setError(null);
  };

  const handleApplySavedDetails = () => {
    if (!savedCustomer) return;
    setUseSavedDetails(true);
    if (savedCustomer.name) setContactName(savedCustomer.name);
    if (savedCustomer.phone) setContactPhone(savedCustomer.phone);
    if (savedCustomer.email) setContactEmail(savedCustomer.email);
    if (savedCustomer.address) {
      if (savedCustomer.address.addressLine1) setAddressLine1(savedCustomer.address.addressLine1);
      if (savedCustomer.address.addressLine2) setAddressLine2(savedCustomer.address.addressLine2);
      if (savedCustomer.address.city) setCity(savedCustomer.address.city);
      if (savedCustomer.address.state) setState(savedCustomer.address.state);
      if (savedCustomer.address.postalCode) setPostalCode(savedCustomer.address.postalCode);
    }
  };

  const handleClearSavedForm = () => {
    setUseSavedDetails(false);
    setContactName('');
    setContactPhone('');
    setContactEmail('');
    setAddressLine1('');
    setAddressLine2('');
    setCity('');
    setState('');
    setPostalCode('');
  };

  const handleForgetSavedDetails = () => {
    clearSavedCustomer();
    setSavedCustomer(null);
    setUseSavedDetails(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return; // Prevent duplicate submission
    setError(null);
    setConflictAlternatives(null);

    if (!isOnline) {
      setError(
        'You are currently offline. A live internet connection is required to check real-time stock feasibility and place your order. Please reconnect and try again.'
      );
      return;
    }

    // Customer Name Validation (Mandatory)
    const trimmedName = contactName.trim();
    if (!trimmedName) {
      setError('Customer name is required.');
      return;
    }

    // Customer Phone Validation (Mandatory, at least 10 digits)
    const trimmedPhone = contactPhone.trim();
    const digitsOnly = trimmedPhone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      setError('Please enter a valid phone number with at least 10 digits.');
      return;
    }

    // Next-Day-Onward Date Validation
    if (!selectedDate || selectedDate < tomorrowStr) {
      setError('Orders must be scheduled at least one day in advance. Select tomorrow or a later date.');
      return;
    }

    if (!selectedSlot) {
      setError(`Please select an available ${orderType === 'DELIVERY' ? 'delivery' : 'pickup'} time slot.`);
      return;
    }

    // Delivery Address Validation (Required for DELIVERY, not required for PICKUP)
    if (orderType === 'DELIVERY') {
      if (!addressLine1.trim() || !city.trim() || !postalCode.trim()) {
        setError('Please provide complete delivery address details (Street address, City, and Postal code).');
        return;
      }
    }

    try {
      setSubmitting(true);

      const payload = {
        orderType,
        paymentMethod,
        deliveryDate: selectedDate,
        deliveryTimeSlot: selectedSlot,
        contactName: trimmedName,
        contactPhone: trimmedPhone,
        contactEmail: contactEmail.trim() || undefined,
        specialInstructions: specialInstructions.trim() || undefined,
        packInstructions: packInstructions.trim() || undefined,
        guestId: !user ? getGuestId() : undefined,
      };

      if (orderType === 'DELIVERY') {
        payload.deliveryAddress = {
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || undefined,
          city: city.trim(),
          state: state.trim() || undefined,
          postalCode: postalCode.trim(),
        };
      }

      const res = await api.checkout(payload, checkoutKey);
      const order = res.data?.order || res.data;

      const wasReturningCustomer = Boolean(savedCustomer && (savedCustomer.orderIds?.length > 0 || savedCustomer.phone));

      // Save customer details in browser localStorage upon successful order
      saveCustomerDetails({
        name: trimmedName,
        phone: trimmedPhone,
        email: contactEmail.trim(),
        address: orderType === 'DELIVERY' ? {
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim(),
          city: city.trim(),
          state: state.trim(),
          postalCode: postalCode.trim(),
        } : (savedCustomer?.address || null),
        orderId: order._id,
      });

      // Clear the local cart
      await clearCart();

      if (paymentMethod === 'MANUAL_UPI') {
        const tokenParam = order.guestTrackingToken
          ? `?token=${order.guestTrackingToken}&orderNumber=${order.orderNumber}&returning=${wasReturningCustomer ? '1' : '0'}`
          : `?orderNumber=${order.orderNumber}&returning=${wasReturningCustomer ? '1' : '0'}`;
        navigate(`/payment-upi/${order._id}${tokenParam}`);
      } else {
        // Pay on Delivery (COD) orders confirm directly without advance payment
        const tokenParam = order.guestTrackingToken
          ? `?orderNumber=${order.orderNumber}&token=${order.guestTrackingToken}`
          : `?orderNumber=${order.orderNumber}`;
        navigate(`/track${tokenParam}`);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      if (err.data?.data?.availableAlternatives) {
        setConflictAlternatives(err.data.data.availableAlternatives);
      }
      setError(err.message || 'Failed to place order. Please review your details and selected time slot.');
    } finally {
      setSubmitting(false);
    }
  };

  const currentDateObj = slotsData?.dates?.find((d) => d.date === selectedDate);

  return (
    <div className="container checkout-page" style={{ padding: '2.5rem 1.5rem 5rem 1.5rem', maxWidth: '1040px' }}>
      <PageHeader
        backTo="/cart"
        backLabel="Back to Basket"
        title="Checkout & Payment"
        subtitle="Convenient bakery ordering with verified delivery slots and flexible payment options"
      />

      {error && (
        <div
          className="alert alert-danger"
          role="alert"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '2rem' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Unable to place order:</strong>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem' }}>{error}</p>
            </div>
          </div>

          {conflictAlternatives && conflictAlternatives.length > 0 && (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(0,0,0,0.05)',
              }}
            >
              <span style={{ fontSize: '0.84rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                Recommended Available Alternative Slots:
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {conflictAlternatives.map((alt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyAlternativeSlot(alt.date, alt.timeSlot)}
                    className="btn btn-sm btn-outline"
                    style={{ fontSize: '0.82rem', backgroundColor: '#ffffff' }}
                  >
                    {alt.formattedDate || alt.date} · {alt.timeSlot} (Apply)
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="checkout-grid">
          {/* Left Column: Fulfillment & Contact Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Step 1: Fulfillment Selection */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
                <span
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                  }}
                >
                  1
                </span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Fulfillment Method
                </h3>
              </div>

              <div
                className="fulfillment-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                }}
              >
                {/* Bakery Pickup Button */}
                <button
                  type="button"
                  onClick={() => setOrderType('PICKUP')}
                  className={`fulfillment-option ${orderType === 'PICKUP' ? 'selected' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '1.25rem',
                    borderRadius: '12px',
                    border: orderType === 'PICKUP' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: orderType === 'PICKUP' ? 'var(--primary-light)' : '#ffffff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: orderType === 'PICKUP' ? 'var(--primary)' : 'var(--bg-main)',
                      color: orderType === 'PICKUP' ? '#ffffff' : 'var(--text-main)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Store size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-main)' }}>
                      Bakery Counter Pickup
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Collect freshly packed from bakery counter
                    </p>
                  </div>
                </button>

                {/* Home Delivery Button */}
                <button
                  type="button"
                  onClick={() => setOrderType('DELIVERY')}
                  className={`fulfillment-option ${orderType === 'DELIVERY' ? 'selected' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '1.25rem',
                    borderRadius: '12px',
                    border: orderType === 'DELIVERY' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: orderType === 'DELIVERY' ? 'var(--primary-light)' : '#ffffff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: orderType === 'DELIVERY' ? 'var(--primary)' : 'var(--bg-main)',
                      color: orderType === 'DELIVERY' ? '#ffffff' : 'var(--text-main)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Truck size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-main)' }}>
                      Doorstep Delivery
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Delivered straight to your location
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Step 2: Delivery Date & Time Slot Selection */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                    }}
                  >
                    2
                  </span>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                    {orderType === 'DELIVERY' ? 'Select Delivery Date & Time Slot' : 'Select Pickup Date & Time Slot'}
                  </h3>
                </div>
                {slotsLoading && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <RotateCw size={12} className="spinning" /> Checking slots...
                  </span>
                )}
              </div>

              {/* Advance Booking Required Notice */}
              <div
                className="alert alert-info"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  marginBottom: '1.25rem',
                  fontSize: '0.84rem',
                  borderRadius: '8px',
                  backgroundColor: '#eff6ff',
                  borderColor: '#bfdbfe',
                  color: '#1e40af',
                }}
              >
                <Calendar size={16} style={{ flexShrink: 0 }} />
                <span>Orders must be scheduled at least one day in advance. Select tomorrow or a later date.</span>
              </div>

              {slotsData?.dates && slotsData.dates.length > 0 ? (
                <div>
                  {/* Date Selector Pills */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label
                      htmlFor="checkout-delivery-date"
                      style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-main)' }}
                    >
                      Select Delivery/Pickup Date <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        overflowX: 'auto',
                        paddingBottom: '6px',
                      }}
                    >
                      {slotsData.dates.map((d) => {
                        const isSelected = selectedDate === d.date;
                        const hasAvailableSlots = d.slots.some((s) => s.isAvailable);
                        const isPastOrToday = d.date < tomorrowStr;
                        return (
                          <button
                            key={d.date}
                            type="button"
                            disabled={isPastOrToday}
                            onClick={() => handleDateSelect(d.date)}
                            style={{
                              flex: '0 0 auto',
                              padding: '10px 14px',
                              borderRadius: '10px',
                              border: isSelected
                                ? '2px solid var(--primary)'
                                : '1px solid var(--border-color)',
                              backgroundColor: isSelected
                                ? 'var(--primary-light)'
                                : isPastOrToday
                                ? '#f3f4f6'
                                : '#ffffff',
                              cursor: isPastOrToday ? 'not-allowed' : 'pointer',
                              opacity: isPastOrToday ? 0.5 : 1,
                              textAlign: 'center',
                              minWidth: '110px',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                              {d.isToday ? 'Today' : d.formattedDate?.split(',')[0] || ''}
                            </div>
                            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
                              {d.formattedDate?.split(',')[1]?.trim() || d.date}
                            </div>
                            <div
                              style={{
                                fontSize: '0.72rem',
                                marginTop: '4px',
                                color: isPastOrToday ? 'var(--text-muted)' : hasAvailableSlots ? 'var(--success)' : 'var(--danger)',
                                fontWeight: 600,
                              }}
                            >
                              {isPastOrToday ? 'Past / Today' : hasAvailableSlots ? 'Slots available' : 'Fully booked'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Time Slot Selection Grid for Selected Date */}
                  <div>
                    <label style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-main)' }}>
                      Select Time Slot <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    {currentDateObj?.slots && currentDateObj.slots.length > 0 ? (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                          gap: '10px',
                        }}
                      >
                        {currentDateObj.slots.map((s, idx) => {
                          const slotValue = s.slot || s.timeSlot;
                          const isSelected = selectedSlot === slotValue;
                          return (
                            <button
                              key={slotValue || idx}
                              type="button"
                              disabled={!s.isAvailable}
                              onClick={() => setSelectedSlot(slotValue)}
                              style={{
                                padding: '12px 14px',
                                borderRadius: '10px',
                                border: isSelected
                                  ? '2px solid var(--primary)'
                                  : '1px solid var(--border-color)',
                                backgroundColor: isSelected
                                  ? 'var(--primary-light)'
                                  : s.isAvailable
                                  ? '#ffffff'
                                  : '#f9fafb',
                                cursor: s.isAvailable ? 'pointer' : 'not-allowed',
                                opacity: s.isAvailable ? 1 : 0.6,
                                textAlign: 'left',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                <Clock size={14} color={isSelected ? 'var(--primary)' : 'var(--text-muted)'} />
                                <strong style={{ fontSize: '0.9rem', color: isSelected ? 'var(--primary-dark)' : 'var(--text-main)' }}>
                                  {s.label || s.slot}
                                </strong>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.76rem',
                                  color: s.isAvailable ? 'var(--success)' : 'var(--danger)',
                                  fontWeight: 600,
                                }}
                              >
                                {s.isAvailable
                                  ? `${s.remainingSpots} spot${s.remainingSpots === 1 ? '' : 's'} remaining`
                                  : s.reason || 'Unavailable'}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '1rem', textAlign: 'center' }}>
                        No operating time slots available for this date.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '1rem', textAlign: 'center' }}>
                  {slotsLoading ? 'Determining available schedule slots...' : 'Schedule slots unavailable. Please retry.'}
                </div>
              )}
            </div>

            {/* Step 3: Contact Information */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
                <span
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                  }}
                >
                  3
                </span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Contact Information
                </h3>
              </div>

              {/* Saved Customer Details Banner */}
              {savedCustomer && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: useSavedDetails ? '#eff6ff' : 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserCheck size={18} color="var(--primary)" />
                    <div>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'block' }}>
                        Use Saved Customer Details
                      </strong>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {savedCustomer.name ? `${savedCustomer.name} · ` : ''}{savedCustomer.phone}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {!useSavedDetails ? (
                      <button
                        type="button"
                        onClick={handleApplySavedDetails}
                        className="btn btn-sm btn-primary"
                        style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                      >
                        Auto-fill Details
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleClearSavedForm}
                        className="btn btn-sm btn-outline"
                        style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                      >
                        Clear Details
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleForgetSavedDetails}
                      className="btn btn-sm btn-outline"
                      style={{ fontSize: '0.78rem', padding: '4px 8px', color: 'var(--danger)' }}
                      title="Remove saved details from this browser"
                    >
                      Forget
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label htmlFor="checkout-name" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                    Customer Name <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="checkout-name"
                      type="text"
                      required
                      className="input-field"
                      placeholder="e.g. John Doe (required)"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      style={{ paddingLeft: '38px', margin: 0 }}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="checkout-phone" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                    Phone Number <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="checkout-phone"
                      type="tel"
                      required
                      className="input-field"
                      placeholder="e.g. 9876543210 (at least 10 digits)"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      style={{ paddingLeft: '38px', margin: 0 }}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="checkout-email" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                    Email Address (Optional)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="checkout-email"
                      type="email"
                      className="input-field"
                      placeholder="e.g. name@example.com (for order receipt)"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      style={{ paddingLeft: '38px', margin: 0 }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4: Delivery Address (conditional on DELIVERY) */}
            {orderType === 'DELIVERY' && (
              <div className="card animate-expand" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                    }}
                  >
                    4
                  </span>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                    Delivery Address
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label htmlFor="checkout-address-1" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                      Street Address / House No. <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <MapPin size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        id="checkout-address-1"
                        type="text"
                        required
                        className="input-field"
                        placeholder="House / Flat No., Building, Street"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        style={{ paddingLeft: '38px', margin: 0 }}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="checkout-address-2" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                      Landmark / Locality (Optional)
                    </label>
                    <input
                      id="checkout-address-2"
                      type="text"
                      className="input-field"
                      placeholder="Near Landmark, Colony / Area"
                      value={addressLine2}
                      onChange={(e) => setAddressLine2(e.target.value)}
                    />
                  </div>

                  <div className="form-grid-3">
                    <div>
                      <label htmlFor="checkout-city" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                        City <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        id="checkout-city"
                        type="text"
                        required
                        className="input-field"
                        placeholder="City"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      />
                    </div>

                    <div>
                      <label htmlFor="checkout-state" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                        State
                      </label>
                      <input
                        id="checkout-state"
                        type="text"
                        className="input-field"
                        placeholder="State"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                      />
                    </div>

                    <div>
                      <label htmlFor="checkout-pincode" style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-main)' }}>
                        Pincode <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        id="checkout-pincode"
                        type="text"
                        required
                        className="input-field"
                        placeholder="e.g. 560001"
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Special Instructions */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                <FileText size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Baking & Delivery Notes
                </h3>
              </div>
              <textarea
                className="input-field"
                rows={2}
                placeholder="E.g., please slice the bread, leave with security guard, extra napkins..."
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                style={{ resize: 'vertical', fontSize: '0.9rem', marginBottom: '1rem' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <Package size={17} color="var(--primary)" />
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Pack-Size / Packaging Preference (Optional)
                </h4>
              </div>
              <input
                type="text"
                className="input-field"
                placeholder="E.g., split into 2 packs of 1 kg each, gift wrapping, separate boxes..."
                value={packInstructions}
                onChange={(e) => setPackInstructions(e.target.value)}
                style={{ fontSize: '0.9rem' }}
              />
            </div>
          </div>

          {/* Right Column: Payment Method & Order Review */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Payment Method Selector Card */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-main)' }}>
                Payment Method
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Choose your preferred payment method.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Option 1: UPI */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod('MANUAL_UPI')}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '1rem',
                    borderRadius: '12px',
                    border: paymentMethod === 'MANUAL_UPI' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: paymentMethod === 'MANUAL_UPI' ? 'var(--primary-light)' : '#ffffff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: paymentMethod === 'MANUAL_UPI' ? 'var(--primary)' : 'var(--bg-main)',
                      color: paymentMethod === 'MANUAL_UPI' ? '#ffffff' : 'var(--text-main)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <QrCode size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--text-main)' }}>
                      Direct Bakery UPI QR (Scan & Pay)
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Scan dynamic bakery QR via Google Pay, PhonePe, or Paytm. Upload payment screenshot for quick manager verification.
                    </p>
                  </div>
                </button>

                {/* Option 2: Pay on Delivery */}
                <button
                  type="button"
                  onClick={() => setPaymentMethod('COD')}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '1rem',
                    borderRadius: '12px',
                    border: paymentMethod === 'COD' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                    backgroundColor: paymentMethod === 'COD' ? 'var(--primary-light)' : '#ffffff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: paymentMethod === 'COD' ? 'var(--primary)' : 'var(--bg-main)',
                      color: paymentMethod === 'COD' ? '#ffffff' : 'var(--text-main)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Banknote size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--text-main)' }}>
                      {orderType === 'DELIVERY' ? 'Pay on Delivery' : 'Pay at Bakery Counter'}
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Pay with Cash or UPI upon receiving your order. No advance payment required; confirmed immediately.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Items Summary in Checkout */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-main)' }}>
                Order Items ({items.length})
              </h3>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  marginBottom: '1.25rem',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
              >
                {items.map((i) => (
                  <div
                    key={i._id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.88rem',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{i.product?.name}</span>
                      {i.variant?.name && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '4px' }}>
                          ({i.variant.name})
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>× {i.quantity}</span>
                    </div>
                    <span style={{ fontWeight: 700 }}>{formatCurrency(getCartLineTotal(i))}</span>
                  </div>
                ))}
              </div>

              {selectedDate && selectedSlot && (
                <div
                  style={{
                    backgroundColor: 'var(--bg-main)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--text-main)',
                  }}
                >
                  <Calendar size={14} color="var(--primary)" />
                  <span>
                    Scheduled: <strong>{selectedDate}</strong> ({selectedSlot})
                  </span>
                </div>
              )}

              <PriceSummary
                subtotal={totalAmount}
                orderType={orderType}
                packagingFee={0}
                total={totalAmount}
                showUpiNotice={false}
              />

              {!isOnline && (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    backgroundColor: '#78350f',
                    color: '#fef3c7',
                    fontSize: '0.84rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>Internet connection required to verify live stock and place your order.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !isOnline || !selectedDate || !selectedSlot}
                className="btn btn-primary btn-lg"
                style={{
                  width: '100%',
                  marginTop: '1.25rem',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '0.95rem 1.5rem',
                }}
              >
                {submitting ? (
                  <>
                    <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
                    <span>Placing Your Order...</span>
                  </>
                ) : paymentMethod === 'MANUAL_UPI' ? (
                  <>
                    <QrCode size={20} />
                    <span>Place Order & Pay via UPI</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={20} />
                    <span>Confirm Order (Pay on Delivery)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
