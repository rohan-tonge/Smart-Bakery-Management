import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Leaf } from 'lucide-react';
import CatalogImage from './CatalogImage';
import ProductQuantityControl from './ProductQuantityControl';
import { formatCurrency } from '../utils/currency';
import { formatDurationMinutes } from '../utils/duration';

export default function ProductCard({
  product,
  selectedVariantId,
  onVariantChange,
  index = 0,
}) {
  const hasVariants = product.variants && product.variants.length > 0;
  const activeVariantId = selectedVariantId || (hasVariants ? product.variants[0]._id : null);
  const activeVariant = hasVariants
    ? product.variants.find((v) => v._id === activeVariantId) || product.variants[0]
    : null;
  const displayPrice = activeVariant ? activeVariant.price : (product.price || product.basePrice || 0);
  const isAvailable = Boolean(product.isAvailable && product.isActive && activeVariant?.isAvailable !== false && activeVariant?.isActive !== false);

  const totalTime = product.totalTimeMinutes ?? ((product.preparationTime || 0) + (product.productionTime || 0));

  return (
    <article className={`product-card stagger-${index % 12}`} aria-label={product.name}>
      {/* Product Image Media Container */}
      <Link
        to={`/product/${product._id}`}
        className="product-card-media"
        aria-label={`View details for ${product.name}`}
      >
        <CatalogImage
          src={product.imageUrl || product.images?.[0] || product.image}
          alt={product.name}
        />

        {/* Status Badges Overlay */}
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            right: '10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {product.isVegetarian && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'var(--nav-bg)',
                  color: 'var(--success)',
                  border: '1px solid var(--border-color)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  boxShadow: 'var(--shadow-sm)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <Leaf size={12} color="var(--success)" />
                <span>Veg</span>
              </span>
            )}
          </div>

          <div>
            {!isAvailable ? (
              <span
                style={{
                  backgroundColor: 'var(--danger-light)',
                  color: 'var(--danger)',
                  border: '1px solid var(--border-color)',
                  padding: '4px 9px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                }}
              >
                Sold Out
              </span>
            ) : totalTime > 0 ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'var(--nav-bg)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  boxShadow: 'var(--shadow-sm)',
                }}
                title="Total Time to Make Product"
              >
                <Clock size={12} color="var(--primary)" />
                <span>{formatDurationMinutes(totalTime)}</span>
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      {/* Card Body */}
      <div className="product-card-body">
        {/* Category Pill */}
        {product.category?.name && (
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '4px',
            }}
          >
            {product.category.name}
          </span>
        )}

        {/* Title */}
        <h3
          style={{
            fontSize: '1.12rem',
            fontWeight: 700,
            margin: '0 0 6px 0',
            color: 'var(--text-main)',
            lineHeight: 1.3,
          }}
        >
          <Link
            to={`/product/${product._id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            {product.name}
          </Link>
        </h3>

        {/* Description clamped */}
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.86rem',
            margin: '0 0 1rem 0',
            flex: 1,
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {product.description || 'Artisanal bake prepared fresh daily with premium ingredients.'}
        </p>

        {/* Variant Selector */}
        {hasVariants && (
          <div style={{ marginBottom: '0.85rem' }}>
            <label
              htmlFor={`variant-select-${product._id}`}
              style={{
                fontSize: '0.74rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Option / Size
            </label>
            <select
              id={`variant-select-${product._id}`}
              className="input-field"
              value={activeVariantId || ''}
              onChange={(e) => onVariantChange && onVariantChange(product._id, e.target.value)}
              style={{
                fontSize: '0.84rem',
                padding: '6px 10px',
                margin: 0,
                height: '34px',
                borderRadius: '8px',
              }}
            >
              {product.variants.map((v) => (
                <option key={v._id} value={v._id} disabled={!v.isActive || !v.isAvailable}>
                  {v.name} · {formatCurrency(v.price)} {(!v.isActive || !v.isAvailable) ? '(Out of stock)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Price & Action Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                display: 'block',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Price
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {formatCurrency(displayPrice)}
              </span>
            </div>
          </div>

          <div>
            <ProductQuantityControl
              productId={product._id}
              variantId={activeVariantId}
              available={isAvailable}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
