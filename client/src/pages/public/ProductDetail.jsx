import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useCart } from '../../context/CartContext';
import {
  ArrowLeft,
  AlertCircle,
  Sparkles,
  Clock,
  Leaf,
  ShoppingBag,
} from 'lucide-react';
import CatalogImage from '../../components/CatalogImage';
import ProductQuantityControl from '../../components/ProductQuantityControl';
import MobileCartSummary from '../../components/MobileCartSummary';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/currency';
import { formatDurationMinutes } from '../../utils/duration';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { items, loading: cartLoading, addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    let active = true;
    async function fetchProduct() {
      try {
        setLoading(true);
        setError(null);
        const response = await api.getProductById(id);
        if (!active) return;
        const result = response.data?.product || response.data;
        setProduct(result);
        setSelectedVariantId(result.variants?.[0]?._id || '');
      } catch (requestError) {
        if (active) setError(requestError.message || 'Product not found');
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchProduct();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem', maxWidth: '1000px' }}>
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem auto' }} />
          <p style={{ color: 'var(--text-muted)' }}>Preparing product details...</p>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container" style={{ padding: '4rem 1.5rem', maxWidth: '600px', textAlign: 'center' }}>
        <div className="card" style={{ padding: '3rem 2rem' }}>
          <div className="alert alert-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem' }}>
            <AlertCircle size={20} />
            <span>{error || 'Product not found'}</span>
          </div>
          <div>
            <Link to="/" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <ArrowLeft size={16} /> Return to Menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentVariant =
    product.variants?.find((variant) => variant._id === selectedVariantId) ||
    product.variants?.[0];

  const matchingLine = items.find(
    (item) =>
      String(item.product?._id || item.product) === String(product._id) &&
      String(item.variant?._id || item.variant) === String(currentVariant?._id)
  );
  const currentQuantity = matchingLine?.quantity || 0;
  const unitPrice = currentVariant?.price ?? product.basePrice ?? 0;
  const available = Boolean(
    product.isActive &&
      product.isAvailable &&
      currentVariant?.isActive !== false &&
      currentVariant?.isAvailable !== false &&
      currentVariant?._id
  );

  const totalTime = product.totalTimeMinutes ?? ((product.preparationTime || 0) + (product.productionTime || 0));

  const buyNow = async () => {
    if (!available || cartLoading || buying) return;
    setBuying(true);
    try {
      if (currentQuantity === 0) {
        await addToCart({
          productId: product._id,
          variantId: currentVariant._id,
          quantity: 1,
        });
      }
      navigate('/cart');
    } catch (requestError) {
      toast.error(`Could not add this item: ${requestError.message}`);
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="container product-detail-page" style={{ padding: '2.5rem 1.5rem 4rem 1.5rem', maxWidth: '1080px' }}>
      <PageHeader
        backTo="/"
        backLabel="Back to Fresh Menu"
        title={product.name}
        subtitle={product.category?.name ? `Category: ${product.category.name}` : undefined}
      />

      {!available && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: '1.5rem' }}>
          <AlertCircle size={18} />
          <span>This product or selected size is currently out of stock or unavailable.</span>
        </div>
      )}

      <div className="card product-detail-grid product-detail-card" style={{ padding: '2rem' }}>
        {/* Left: Media Gallery */}
        <div
          className="product-detail-media"
          style={{
            position: 'relative',
            borderRadius: '16px',
            overflow: 'hidden',
            minHeight: '340px',
            backgroundColor: 'var(--primary-light)',
          }}
        >
          <CatalogImage
            src={product.imageUrl || product.images?.[0] || product.image}
            alt={product.name}
          />

          {/* Badges on Image */}
          <div
            style={{
              position: 'absolute',
              top: '14px',
              left: '14px',
              display: 'flex',
              gap: '6px',
            }}
          >
            {product.isVegetarian && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'var(--nav-bg)',
                  color: 'var(--success)',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  border: '1px solid var(--border-color)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <Leaf size={14} color="var(--success)" />
                <span>100% Vegetarian</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Details & Purchase Options */}
        <div className="product-detail-info" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              {product.category?.name && (
                <span className="badge badge-info">{product.category.name}</span>
              )}
              {totalTime > 0 && (
                <span
                  id="product-total-time-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                  }}
                  title="Total Time to Make Product (Preparation and Baking)"
                >
                  <Clock size={14} />
                  <span>Total Time to Make Product: <strong>{formatDurationMinutes(totalTime)}</strong></span>
                </span>
              )}
            </div>

            <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.3rem)', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>
              {product.name}
            </h1>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.96rem', lineHeight: '1.6', margin: 0 }}>
              {product.description || 'Artisanal product baked fresh daily using slow fermentation and traditional oven baking techniques.'}
            </p>
          </div>

          {/* Variant Selector */}
          {product.variants?.length > 0 && (
            <div className="product-variant-picker" style={{ padding: '1rem', backgroundColor: 'var(--bg-main)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <label htmlFor="product-variant-select" style={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
                Select Size / Weight Option
              </label>
              <select
                id="product-variant-select"
                className="input-field"
                value={currentVariant?._id || ''}
                onChange={(event) => setSelectedVariantId(event.target.value)}
                style={{ fontSize: '0.92rem' }}
              >
                {product.variants.map((variant) => (
                  <option
                    key={variant._id}
                    value={variant._id}
                    disabled={!variant.isActive || !variant.isAvailable}
                  >
                    {variant.name} · {formatCurrency(variant.price)} {(!variant.isActive || !variant.isAvailable) ? '(Unavailable)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Price & Summary */}
          <div
            style={{
              padding: '1.25rem',
              borderRadius: '12px',
              backgroundColor: 'var(--primary-light)',
              border: '1px solid var(--primary-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--primary-dark)', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>
                Price Per Item
              </span>
              <strong style={{ fontSize: '1.85rem', color: 'var(--primary)', fontWeight: 800 }}>
                {formatCurrency(unitPrice)}
              </strong>
            </div>

            {currentQuantity > 0 && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>
                  {currentQuantity} in basket
                </span>
                <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {formatCurrency(unitPrice * currentQuantity)}
                </span>
              </div>
            )}
          </div>

          {/* Quantity Controls & Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <ProductQuantityControl
              productId={product._id}
              variantId={currentVariant?._id}
              available={available}
            />

            <button
              type="button"
              className="btn btn-primary"
              disabled={!available || cartLoading || buying}
              onClick={buyNow}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0.75rem 1.5rem' }}
            >
              <ShoppingBag size={18} />
              <span>{buying ? 'Opening Basket...' : currentQuantity > 0 ? 'Go to Basket' : 'Add & View Basket'}</span>
            </button>
          </div>

          {/* Guarantee Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border-color)',
              color: '#15803d',
              fontSize: '0.88rem',
              fontWeight: 600,
            }}
          >
            <Sparkles size={16} />
            <span>Small-batch crafted · Zero artificial preservatives</span>
          </div>
        </div>
      </div>

      <MobileCartSummary />
    </div>
  );
}
