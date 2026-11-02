import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import {
  CheckCircle,
  Copy,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Clock,
  Upload,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import StatusBadge from '../../components/StatusBadge';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../context/ToastContext';
import { usePwa } from '../../context/PwaContext';
import { formatCurrency } from '../../utils/currency';
import { isReturningCustomer, getSavedCustomer } from '../../utils/savedCustomer';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ManualUpiPayment() {
  const { orderId } = useParams();
  const { isOnline } = usePwa();
  const [searchParams] = useSearchParams();
  const orderNumberParam = searchParams.get('orderNumber');
  const token = searchParams.get('token');

  const [order, setOrder] = useState(null);
  const [qrSettings, setQrSettings] = useState({
    upiId: '',
    payeeName: '',
    instructions: '',
    qrImageUrl: '',
  });

  // Screenshot upload state
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [screenshotBase64, setScreenshotBase64] = useState('');
  const [fileError, setFileError] = useState(null);
  const returningParam = searchParams.get('returning');
  const [isReturning, setIsReturning] = useState(() => {
    if (returningParam === '1') return true;
    if (returningParam === '0') return false;
    return isReturningCustomer(orderId);
  });

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [markedPaid, setMarkedPaid] = useState(false);
  const [paymentSetupError, setPaymentSetupError] = useState(null);
  const [qrImageFailed, setQrImageFailed] = useState(false);

  const { success } = useToast();

  useEffect(() => {
    async function loadPaymentDetails() {
      try {
        setLoading(true);
        // Load QR settings
        const qrRes = await api.getPaymentQr();
        if (qrRes.data) {
          setQrSettings((prev) => ({
            ...prev,
            ...qrRes.data,
          }));
          if (qrRes.data.isPlaceholder) {
            setPaymentSetupError(
              qrRes.data.placeholderNotice ||
                'The bakery has not configured its official UPI payment details yet. Please contact the bakery before paying.'
            );
          } else if (!qrRes.data.upiId && !qrRes.data.qrImageUrl) {
            setPaymentSetupError(
              'The bakery payment details are not configured yet. Please contact the bakery before paying.'
            );
          }
        }

        // Load Order details
        if (orderId) {
          try {
            const ordRes =
              orderNumberParam && token
                ? await api.trackOrder({ orderNumber: orderNumberParam, token })
                : await api.getOrderById(orderId);
            const ord = ordRes.data?.order || ordRes.data;
            setOrder(ord);
            if (
              ['PENDING_VERIFICATION', 'CUSTOMER_MARKED_PAID', 'PAYMENT_CONFIRMED', 'SUCCESS'].includes(
                ord.paymentStatus
              )
            ) {
              setMarkedPaid(true);
            }
          } catch (orderError) {
            if (orderNumberParam) {
              try {
                const trackRes = await api.trackOrder({ orderNumber: orderNumberParam, token });
                const ord = trackRes.data?.order || trackRes.data;
                setOrder(ord);
                if (
                  ['PENDING_VERIFICATION', 'CUSTOMER_MARKED_PAID', 'PAYMENT_CONFIRMED', 'SUCCESS'].includes(
                    ord.paymentStatus
                  )
                ) {
                  setMarkedPaid(true);
                }
              } catch (trackingError) {
                setPaymentSetupError(
                  trackingError.message || orderError.message || 'Could not load this order. Please use its secure tracking link.'
                );
              }
            } else {
              setPaymentSetupError(orderError.message || 'Could not load this order.');
            }
          }
        }
      } catch (err) {
        setPaymentSetupError(err.message || 'Could not load the bakery payment details.');
      } finally {
        setLoading(false);
      }
    }
    loadPaymentDetails();
  }, [orderId, orderNumberParam, token]);

  const orderNum = order?.orderNumber || orderNumberParam || 'Order #' + orderId?.substring(0, 8);
  const payableAmount = order?.total ?? order?.pricing?.total ?? order?.totalAmount ?? null;
  const upiId = qrSettings.upiId || '';
  const payeeName = qrSettings.payeeName || '';
  const canPay = Boolean(order && Number(payableAmount) > 0 && !qrSettings.isPlaceholder && !paymentSetupError);
  const paymentRejected =
    order?.paymentStatus === 'PAYMENT_REJECTED' || ['CANCELLED', 'EXPIRED'].includes(order?.status);
  const paymentVerified = ['PAYMENT_CONFIRMED', 'SUCCESS'].includes(order?.paymentStatus);

  // Construct UPI URI
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    payeeName
  )}&am=${payableAmount}&cu=INR&tn=${encodeURIComponent(orderNum)}`;
  const dynamicQrCodeUrl =
    canPay &&
    (qrSettings.qrImageUrl ||
      (upiId
        ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUri)}`
        : ''));

  const copyUpiId = () => {
    navigator.clipboard.writeText(upiId);
    setCopied(true);
    success('UPI ID copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setFileError(null);
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setFileError('Invalid file type. Please upload a JPEG, PNG, or WebP screenshot.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFileError('File exceeds 10MB limit. Please upload a smaller image.');
      return;
    }

    setScreenshotFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      setScreenshotPreview(dataUrl);
      setScreenshotBase64(dataUrl);
    };
    reader.onerror = () => {
      setFileError('Failed to read image file. Please try again.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = () => {
    setScreenshotFile(null);
    setScreenshotPreview(null);
    setScreenshotBase64('');
    setFileError(null);
  };

  const handleMarkPaid = async (e) => {
    e.preventDefault();
    if (!isOnline) {
      setError('You are currently offline. A live internet connection is required to submit your payment verification.');
      return;
    }

    // First-time customer: screenshot is strictly required
    if (!screenshotBase64 && !isReturning) {
      setError('Payment screenshot is required for first-time customers. Please upload your payment receipt.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await api.markCustomerPaid(orderId, {
        screenshot: screenshotBase64 || undefined,
        mimeType: screenshotBase64 ? (screenshotFile?.type || 'image/png') : undefined,
        fileName: screenshotBase64 ? (screenshotFile?.name || 'payment_screenshot.png') : undefined,
        amount: Number(payableAmount),
        token: token || undefined,
        isReturningCustomer: isReturning,
      });
      setMarkedPaid(true);
      success(
        screenshotBase64
          ? 'Payment screenshot uploaded! Bakery manager will verify shortly.'
          : 'Payment verification requested! Bakery manager will verify shortly.'
      );
      setOrder((current) =>
        current
          ? {
              ...current,
              paymentStatus: 'PENDING_VERIFICATION',
              paymentProof: screenshotBase64
                ? {
                    hasProof: true,
                    uploadedAt: new Date(),
                    isDeleted: false,
                  }
                : current.paymentProof,
            }
          : current
      );
    } catch (err) {
      setError(err.message || 'Could not submit payment verification. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '5rem 1.5rem', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem auto' }}></div>
        <p style={{ color: 'var(--text-muted)' }}>Loading official bakery payment QR code...</p>
      </div>
    );
  }

  return (
    <div className="container payment-page" style={{ padding: '2.5rem 1.5rem 5rem 1.5rem', maxWidth: '720px' }}>
      <PageHeader
        backTo={`/track?orderNumber=${orderNum}${token ? `&token=${token}` : ''}`}
        backLabel="Order Tracking"
        title="Direct Bakery UPI Payment"
        subtitle="Zero transaction fee · Direct settlement to bakery kitchen"
      />

      <div className="card" style={{ padding: '2.5rem 2rem', textAlign: 'center' }}>
        {/* Order Details Strip */}
        <div
          style={{
            backgroundColor: 'var(--bg-main)',
            border: '1px solid var(--border-color)',
            padding: '1.25rem',
            borderRadius: '16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem',
            textAlign: 'left',
          }}
        >
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>
              Order Reference
            </span>
            <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-main)' }}>{orderNum}</span>
          </div>

          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>
              Payable Amount
            </span>
            <span style={{ fontWeight: 800, fontSize: '1.35rem', color: 'var(--primary)' }}>
              {payableAmount == null ? 'Unavailable' : formatCurrency(payableAmount)}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>
              Payment Status
            </span>
            <StatusBadge status={order?.paymentStatus || 'PAYMENT_PENDING'} size="sm" />
          </div>
        </div>

        {paymentSetupError && (
          <div className="alert alert-danger" role="alert" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
            <AlertCircle size={18} />
            <span>{paymentSetupError}</span>
          </div>
        )}

        {paymentRejected && (
          <div className="alert alert-danger" role="alert" style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
            <AlertCircle size={18} />
            <span>The payment could not be confirmed. This order has been cancelled or rejected. Please contact the bakery.</span>
          </div>
        )}

        {markedPaid ? (
          <div style={{ padding: '1rem 0' }}>
            <div
              style={{
                width: '68px',
                height: '68px',
                borderRadius: '50%',
                backgroundColor: paymentVerified ? 'var(--success-light)' : 'var(--primary-light)',
                color: paymentVerified ? 'var(--success)' : 'var(--primary)',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 1.25rem auto',
              }}
            >
              {paymentVerified ? <CheckCircle size={36} /> : <Clock size={36} />}
            </div>

            <h2
              style={{
                fontSize: '1.45rem',
                fontWeight: 800,
                color: paymentVerified ? 'var(--success)' : 'var(--primary-dark)',
                marginBottom: '0.5rem',
              }}
            >
              {paymentVerified ? 'Payment Confirmed by Bakery!' : 'Payment Screenshot Submitted'}
            </h2>

            <p
              style={{
                color: 'var(--text-muted)',
                maxWidth: '480px',
                margin: '0 auto 1.5rem auto',
                lineHeight: '1.6',
                fontSize: '0.94rem',
              }}
            >
              {paymentVerified
                ? 'Your payment has been manually verified by the bakery manager. Your order is now heading to the kitchen.'
                : 'Your payment screenshot has been securely received and is awaiting manual verification by the bakery manager. You can monitor your live order progress below.'}
            </p>

            <div
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                padding: '10px 16px',
                borderRadius: '10px',
                fontSize: '0.82rem',
                color: 'var(--text-main)',
                maxWidth: '460px',
                margin: '0 auto 2rem auto',
                textAlign: 'left',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '2px' }}>
                Privacy & Data Retention Notice:
              </div>
              Uploaded payment screenshots are retained for exactly 30 days for payment auditing and dispute resolution, after which the screenshot binary is automatically purged while order audit records are preserved.
            </div>

            <div>
              <Link
                to={`/track?orderNumber=${orderNum}${token ? `&token=${token}` : ''}`}
                className="btn btn-primary btn-lg"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <span>Track Live Order Status</span>
                <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        ) : (
          <div>
            {/* QR Code Presentation Box */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
              <div
                style={{
                  padding: '16px',
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  boxShadow: 'var(--shadow-md)',
                  border: '1.5px solid var(--border-color)',
                  display: 'inline-block',
                  marginBottom: '1.25rem',
                }}
              >
                {dynamicQrCodeUrl && !qrImageFailed ? (
                  <img
                    src={dynamicQrCodeUrl}
                    alt="Official Bakery UPI QR Code"
                    onError={() => setQrImageFailed(true)}
                    style={{
                      width: '220px',
                      height: '220px',
                      display: 'block',
                      borderRadius: '8px',
                    }}
                  />
                ) : (
                  <div style={{ width: '220px', height: '220px', display: 'grid', placeItems: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    {canPay
                      ? 'QR image could not load. Tap the Open in UPI App button below.'
                      : 'Payment QR is currently unavailable.'}
                  </div>
                )}
              </div>

              {/* UPI ID Pill with copy */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'var(--bg-main)',
                  padding: '6px 14px',
                  borderRadius: '9999px',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.88rem',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>UPI ID:</span>
                <strong style={{ color: 'var(--text-main)' }}>
                  {qrSettings.isPlaceholder ? 'Not configured' : upiId || 'Unavailable'}
                </strong>
                <button
                  type="button"
                  onClick={copyUpiId}
                  disabled={!canPay || !upiId}
                  className="btn btn-sm"
                  style={{
                    padding: '6px 10px',
                    minHeight: '34px',
                    minWidth: '34px',
                    background: 'var(--primary-light)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: 'var(--primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                  }}
                  title="Copy UPI ID"
                  aria-label="Copy UPI ID"
                >
                  {copied ? (
                    <span style={{ color: '#16a34a', fontSize: '0.78rem', fontWeight: 700 }}>Copied!</span>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div style={{ marginTop: '0.65rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Payee: <strong>{payeeName || 'Smart Bakery'}</strong>
              </div>

              {/* Mobile UPI App Deep link */}
              <div style={{ marginTop: '1rem' }}>
                <a
                  href={upiUri}
                  className="btn btn-outline btn-sm"
                  aria-disabled={!canPay}
                  onClick={(event) => {
                    if (!canPay) event.preventDefault();
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <ExternalLink size={14} />
                  <span>Open in UPI App (GPay, PhonePe, Paytm, BHIM)</span>
                </a>
              </div>
            </div>

            {/* Instruction Notice */}
            <div
              className="alert alert-info"
              style={{
                textAlign: 'left',
                marginBottom: '2rem',
                fontSize: '0.88rem',
                backgroundColor: '#eff6ff',
                borderColor: '#bfdbfe',
                color: '#1e40af',
              }}
            >
              <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Payment Verification Steps:</strong>{' '}
                {qrSettings.instructions ||
                  '1. Scan QR code or copy UPI ID. 2. Pay exact amount from your UPI app. 3. Take a screenshot of the successful payment screen and upload it below for manager verification.'}
              </div>
            </div>

            {/* Screenshot Upload Form */}
            <form onSubmit={handleMarkPaid} style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'left' }}>
              {isReturning ? (
                <div
                  className="alert alert-info"
                  style={{
                    textAlign: 'left',
                    marginBottom: '1.25rem',
                    fontSize: '0.86rem',
                    backgroundColor: '#f0fdf4',
                    borderColor: '#bbf7d0',
                    color: '#166534',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#16a34a' }} />
                  <div>
                    <strong>Returning Customer:</strong> Screenshot upload is <strong>optional</strong>. You can upload a payment screenshot if you wish, or proceed directly to verification.
                  </div>
                </div>
              ) : (
                <div
                  className="alert alert-warning"
                  style={{
                    textAlign: 'left',
                    marginBottom: '1.25rem',
                    fontSize: '0.86rem',
                    backgroundColor: '#fffbeb',
                    borderColor: '#fde68a',
                    color: '#92400e',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#d97706' }} />
                  <div>
                    <strong>First-time Customer:</strong> A payment receipt screenshot is <strong>required</strong> to confirm your UPI transfer.
                  </div>
                </div>
              )}

              {error && (
                <div
                  className="alert alert-danger"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}
                >
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {fileError && (
                <div
                  className="alert alert-danger"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}
                >
                  <AlertCircle size={18} />
                  <span>{fileError}</span>
                </div>
              )}

              <div style={{ marginBottom: '1.5rem' }}>
                <label
                  htmlFor="payment-screenshot-upload"
                  style={{ display: 'block', fontSize: '0.88rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}
                >
                  Upload Payment Screenshot {isReturning ? '(Optional)' : <span style={{ color: 'var(--danger)' }}>*</span>}
                </label>

                {!screenshotPreview ? (
                  <label
                    htmlFor="payment-screenshot-upload"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '2rem 1.5rem',
                      border: '2px dashed var(--border-color)',
                      borderRadius: '12px',
                      backgroundColor: 'var(--bg-main)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <Upload size={32} color="var(--primary)" />
                    <div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        Click to select payment screenshot
                      </span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        JPEG, PNG, or WebP up to 10MB
                      </p>
                    </div>
                    <input
                      id="payment-screenshot-upload"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                    />
                  </label>
                ) : (
                  <div
                    style={{
                      border: '1.5px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '12px',
                      backgroundColor: 'var(--bg-main)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                      <img
                        src={screenshotPreview}
                        alt="Payment preview"
                        style={{
                          width: '56px',
                          height: '56px',
                          objectFit: 'cover',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ overflow: 'hidden' }}>
                        <strong
                          style={{
                            fontSize: '0.88rem',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'var(--text-main)',
                          }}
                        >
                          {screenshotFile?.name || 'payment_screenshot.png'}
                        </strong>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          {(screenshotFile?.size / 1024).toFixed(1)} KB · Ready to submit
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      className="btn btn-outline btn-sm"
                      style={{ color: 'var(--danger)', flexShrink: 0 }}
                      title="Remove file"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                  The uploaded screenshot is verified by the bakery manager and automatically purged after 30 days.
                </span>
              </div>

              {!isOnline && (
                <div
                  style={{
                    marginBottom: '1.25rem',
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
                  <span>Internet connection required to upload your payment screenshot.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  !isOnline ||
                  !canPay ||
                  !upiId ||
                  (!isReturning && !screenshotBase64) ||
                  paymentRejected ||
                  order?.paymentStatus === 'PENDING_VERIFICATION'
                }
                className="btn btn-primary btn-lg"
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0.9rem',
                }}
              >
                {submitting ? (
                  <>
                    <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></div>
                    <span>Submitting for Verification...</span>
                  </>
                ) : screenshotBase64 ? (
                  <>
                    <CheckCircle size={20} />
                    <span>Upload Screenshot & Submit for Verification</span>
                  </>
                ) : isReturning ? (
                  <>
                    <CheckCircle size={20} />
                    <span>Place Order</span>
                  </>
                ) : (
                  <>
                    <Upload size={20} />
                    <span>Select Screenshot to Proceed</span>
                  </>
                )}
              </button>

              <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                <Link
                  to={`/track?orderNumber=${orderNum}${token ? `&token=${token}` : ''}`}
                  style={{ color: 'var(--text-muted)', fontSize: '0.86rem', textDecoration: 'none' }}
                >
                  Track order status live →
                </Link>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
