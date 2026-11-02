import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { usePwa } from '../../context/PwaContext';
import {
  Search,
  AlertCircle,
  Sparkles,
  Clock,
  ShieldCheck,
  Flame,
  Truck,
  Croissant,
} from 'lucide-react';
import ProductCard from '../../components/ProductCard';
import CategoryNavigation from '../../components/CategoryNavigation';
import SearchBar from '../../components/SearchBar';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import EmptyState from '../../components/EmptyState';
import MobileCartSummary from '../../components/MobileCartSummary';

export default function Home() {
  const { isOnline } = usePwa();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVariants, setSelectedVariants] = useState({});

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [catsRes, prodsRes] = await Promise.all([
          api.getCategories(),
          api.getProducts(),
        ]);

        const cats = catsRes.data?.categories || catsRes.data || [];
        const prods = prodsRes.data?.products || prodsRes.data || [];

        setCategories(cats);
        setProducts(prods);

        // Pre-select first variant for each product if available
        const defaultVars = {};
        prods.forEach((p) => {
          if (p.variants && p.variants.length > 0) {
            defaultVars[p._id] = p.variants[0]._id;
          }
        });
        setSelectedVariants(defaultVars);
      } catch (err) {
        setError(err.message || 'Failed to load bakery catalog. Please check connection.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleVariantChange = (productId, variantId) => {
    setSelectedVariants((prev) => ({ ...prev, [productId]: variantId }));
  };

  // Filter products based on category and search query
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const pCatId = p.category?._id || p.category;
      const matchesCat = !selectedCategory || String(pCatId) === String(selectedCategory);
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        p.name?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.category?.name?.toLowerCase().includes(query);
      return matchesCat && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Featured items (available items from real API data)
  const featuredProducts = useMemo(() => {
    return products.filter((p) => p.isAvailable && p.isActive).slice(0, 4);
  }, [products]);

  return (
    <div className="storefront-home">
      {/* Modern Hero Section */}
      <section className="hero-section" aria-label="Bakery introduction">
        <div className="hero-content">
          <div
            className="hero-badge-animate"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '9999px',
              backgroundColor: 'var(--primary-light)',
              border: '1px solid var(--primary-subtle)',
              color: 'var(--primary)',
              fontSize: '0.82rem',
              fontWeight: 700,
              marginBottom: '1.25rem',
              boxShadow: '0 2px 6px rgba(234, 88, 12, 0.08)',
            }}
          >
            <Sparkles size={15} />
            <span>Oven Fresh Batches Daily at 6:00 AM</span>
          </div>

          <h1 className="hero-title hero-title-animate">
            Artisanal Breads & Handcrafted Pastries
          </h1>

          <p className="hero-subtitle hero-subtitle-animate">
            Order directly from our kitchen with zero middleman markup. Select store pickup or doorstep delivery, and complete payment smoothly via direct UPI QR.
          </p>

          {/* Quick Features Row */}
          <div
            className="hero-features-animate"
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '1.5rem',
              flexWrap: 'wrap',
              margin: '0 auto 2rem auto',
              fontSize: '0.86rem',
              color: 'var(--text-muted)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={16} color="var(--primary)" />
              <span>Baked Fresh Daily</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={16} color="var(--success)" />
              <span>Direct Bakery UPI</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Truck size={16} color="var(--info)" />
              <span>Pickup & Delivery</span>
            </span>
          </div>

          {/* Hero Actions */}
          <div className="hero-actions hero-actions-animate">
            <a href="#menu-catalog" className="btn btn-primary btn-lg" style={{ gap: '8px' }}>
              <Croissant size={18} />
              <span>Explore Menu</span>
            </a>
            <Link to="/track" className="btn btn-outline btn-lg" style={{ gap: '8px' }}>
              <Search size={18} />
              <span>Track Order</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Main Catalog & Menu Section */}
      <main className="container" id="menu-catalog" style={{ padding: '2.5rem 1.5rem 5rem 1.5rem' }}>
        {/* Menu Header with Search */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            marginBottom: '1.5rem',
          }}
        >
          {!isOnline && (
            <div
              style={{
                padding: '0.625rem 1rem',
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
              <span>Browsing cached menu (offline). Live item availability and pricing will refresh once reconnected.</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: 'clamp(1.5rem, 3.5vw, 1.95rem)', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  Fresh Bakery Menu
                </h2>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '9999px',
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary-dark)',
                  }}
                >
                  {products.length} {products.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', margin: '0.3rem 0 0 0', fontSize: '0.94rem' }}>
                Select your favorite artisanal breads, viennoiseries, and pastries
              </p>
            </div>

            {/* Prominent Search Bar */}
            <div style={{ width: '100%', maxWidth: '360px' }}>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search breads, cakes, croissants..."
              />
            </div>
          </div>

          {/* Horizontal Category Chips */}
          <CategoryNavigation
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            totalItemsCount={products.length}
          />
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
            <AlertCircle size={20} />
            <div>
              <strong>Could not load menu:</strong> {error}
            </div>
          </div>
        )}

        {/* Catalog Content */}
        {loading ? (
          <LoadingSkeleton type="product-grid" count={6} />
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            icon={Croissant}
            title="No bakery items found"
            description={
              searchQuery
                ? `No products matched "${searchQuery}". Try a different keyword or reset filters.`
                : 'There are currently no items available in this category.'
            }
            actionLabel="View All Products"
            onAction={() => {
              setSelectedCategory('');
              setSearchQuery('');
            }}
          />
        ) : (
          <>
            {/* If searching or filtering, show results count */}
            {(searchQuery || selectedCategory) && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.25rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span>
                  Showing {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
                  {searchQuery && ` matching "${searchQuery}"`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('');
                    setSearchQuery('');
                  }}
                  className="btn btn-outline btn-sm"
                  style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                >
                  Clear Filters
                </button>
              </div>
            )}

            {/* Featured Section (only shown when not searching and on All Items) */}
            {!searchQuery && !selectedCategory && featuredProducts.length > 0 && (
              <section style={{ marginBottom: '3rem' }} aria-label="Featured Products">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
                  <Flame size={20} color="var(--primary)" />
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>
                    Chef's Daily Specials
                  </h3>
                </div>

                <div className="product-grid">
                  {featuredProducts.map((product, idx) => (
                    <ProductCard
                      key={`featured-${product._id}`}
                      product={product}
                      selectedVariantId={selectedVariants[product._id]}
                      onVariantChange={handleVariantChange}
                      index={idx}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All Products Section */}
            <section aria-label="All Menu Items">
              {!searchQuery && !selectedCategory && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
                  <Croissant size={20} color="var(--primary)" />
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>
                    Full Bakery Selection
                  </h3>
                </div>
              )}

              <div className="product-grid">
                {filteredProducts.map((product, idx) => (
                  <ProductCard
                    key={product._id}
                    product={product}
                    selectedVariantId={selectedVariants[product._id]}
                    onVariantChange={handleVariantChange}
                    index={idx}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {/* Floating Bottom Cart Bar for Mobile Viewports */}
      <MobileCartSummary />
    </div>
  );
}
