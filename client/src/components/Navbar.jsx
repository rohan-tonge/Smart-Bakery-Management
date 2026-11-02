import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import {
  ShoppingBag,
  Search,
  User,
  LogOut,
  LayoutDashboard,
  Shield,
  Wrench,
  Menu,
  X,
  UtensilsCrossed,
  Croissant,
  Download,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { usePwa } from '../context/PwaContext';
import { formatCurrency } from '../utils/currency';

export default function Navbar() {
  const { user, role, isAuthenticated, logout } = useAuth();
  const { itemCount, totalAmount } = useCart();
  const { canInstall, promptInstall, isIos, isStandalone } = usePwa();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cartBump, setCartBump] = useState(false);
  const prevCountRef = useRef(itemCount);

  useEffect(() => {
    if (itemCount !== prevCountRef.current) {
      prevCountRef.current = itemCount;
      if (itemCount > 0) {
        setCartBump(true);
        const timer = setTimeout(() => setCartBump(false), 380);
        return () => clearTimeout(timer);
      }
    }
  }, [itemCount]);

  const storeVisible = !isAuthenticated || role === 'CUSTOMER';
  const isManager = role === 'OWNER_MANAGER' || role === 'OWNER' || role === 'MANAGER';
  const isStaff = role === 'PRODUCTION_STAFF';

  const dashboard = isManager
    ? { path: '/owner', label: 'Owner & Manager', icon: Shield }
    : isStaff
    ? { path: '/production', label: 'Kitchen Workstation', icon: Wrench }
    : { path: '/customer', label: 'My Orders', icon: LayoutDashboard };

  const DashboardIcon = dashboard.icon;
  const links = storeVisible
    ? [
        { to: '/', label: 'Fresh Menu', icon: UtensilsCrossed },
        { to: '/track', label: 'Track Order', icon: Search },
      ]
    : [{ to: dashboard.path, label: dashboard.label, icon: DashboardIcon }];

  const close = () => setMobileOpen(false);

  const handleLogout = async () => {
    await logout();
    close();
    navigate('/');
  };

  const getRoleLabel = () => {
    if (isManager) return 'Owner';
    if (isStaff) return 'Staff';
    return 'Customer';
  };

  return (
    <header className="navbar">
      <div className="navbar-container">
        {/* Brand Logo */}
        <Link
          to={storeVisible ? '/' : dashboard.path}
          className="brand-logo"
          onClick={close}
          aria-label="Smart Bakery Home"
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              backgroundColor: 'var(--primary-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              flexShrink: 0,
            }}
          >
            <Croissant size={22} strokeWidth={2} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="brand-name">Smart Bakery</span>
            <span
              style={{
                fontSize: '0.68rem',
                color: '#16a34a',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                lineHeight: 1,
                marginTop: '1px',
              }}
            >
              Fresh Everyday
            </span>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="nav-links desktop-only" aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`nav-link ${isActive ? 'highlight' : ''}`}
              >
                <Icon size={16} style={{ marginRight: 6 }} />
                <span>{label}</span>
              </Link>
            );
          })}
          {storeVisible && role === 'CUSTOMER' && (
            <Link
              to="/customer"
              className={`nav-link ${location.pathname === '/customer' ? 'highlight' : ''}`}
            >
              <LayoutDashboard size={16} style={{ marginRight: 6 }} />
              <span>My Orders</span>
            </Link>
          )}
        </nav>

        {/* Actions Area */}
        <div className="nav-actions">
          {storeVisible && (
            <Link
              to="/cart"
              className={`navbar-cart-pill ${cartBump ? 'cart-bump' : ''}`}
              onClick={close}
              aria-label={`View basket, ${itemCount} items, total ${formatCurrency(totalAmount)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                borderRadius: '9999px',
                backgroundColor: itemCount > 0 ? 'var(--primary)' : 'var(--bg-main)',
                color: itemCount > 0 ? '#ffffff' : 'var(--text-main)',
                border: itemCount > 0 ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '0.88rem',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: itemCount > 0 ? '0 2px 8px rgba(234, 88, 12, 0.28)' : 'none',
              }}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <ShoppingBag size={18} strokeWidth={2.2} />
                {itemCount > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-6px',
                      right: '-8px',
                      backgroundColor: '#ffffff',
                      color: 'var(--primary)',
                      fontSize: '0.65rem',
                      fontWeight: 900,
                      minWidth: '16px',
                      height: '16px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 3px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }}
                  >
                    {itemCount}
                  </span>
                )}
              </div>
              <span className="desktop-only" style={{ marginLeft: '4px' }}>
                {itemCount > 0 ? formatCurrency(totalAmount) : 'Basket'}
              </span>
            </Link>
          )}

          {/* User Profile / Auth */}
          {isAuthenticated ? (
            <div className="user-profile-menu desktop-only">
              <span className="user-greeting">
                <User size={14} color="var(--primary)" />
                <span className="user-name">{user?.name || user?.email?.split('@')[0]}</span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary-dark)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {getRoleLabel()}
                </span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-outline btn-sm"
                title="Sign out"
              >
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="auth-buttons desktop-only">
              <Link to="/login" className="btn btn-outline btn-sm">
                Sign in
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                Register
              </Link>
            </div>
          )}

          {/* Install App Button (When installable or iOS) */}
          {(canInstall || (isIos && !isStandalone)) && (
            <button
              type="button"
              onClick={promptInstall}
              className="btn btn-outline btn-sm desktop-only"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                color: 'var(--primary)',
                borderColor: 'var(--primary-subtle, #fed7aa)',
                backgroundColor: 'var(--primary-light, #fff7ed)',
                fontWeight: 600,
              }}
              title="Install Smart Bakery on your device"
            >
              <Download size={14} />
              <span>Install App</span>
            </button>
          )}

          {/* Theme Switcher Toggle */}
          <ThemeToggle />

          {/* Mobile Menu Button */}
          <button
            type="button"
            className="mobile-toggle-btn mobile-only"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="mobile-nav-drawer mobile-only" role="dialog" aria-modal="true">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '1rem 1.25rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0 10px 0',
                borderBottom: '1px solid var(--border-color)',
                marginBottom: '0.25rem',
              }}
            >
              <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-muted)' }}>Theme</span>
              <ThemeToggle variant="segmented" showLabels={true} />
            </div>
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="btn btn-outline btn-sm"
                style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
                onClick={close}
              >
                <Icon size={16} />
                <span>{label}</span>
              </Link>
            ))}

            {storeVisible && role === 'CUSTOMER' && (
              <Link
                to="/customer"
                className="btn btn-outline btn-sm"
                style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
                onClick={close}
              >
                <LayoutDashboard size={16} />
                <span>My Orders</span>
              </Link>
            )}

            {storeVisible && (
              <Link
                to="/cart"
                className="btn btn-outline btn-sm"
                style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
                onClick={close}
              >
                <ShoppingBag size={16} />
                <span>Basket ({itemCount} items · {formatCurrency(totalAmount)})</span>
              </Link>
            )}

            {(canInstall || (isIos && !isStandalone)) && (
              <button
                type="button"
                onClick={() => {
                  close();
                  promptInstall();
                }}
                className="btn btn-outline btn-sm"
                style={{
                  justifyContent: 'flex-start',
                  padding: '10px 14px',
                  color: 'var(--primary)',
                  borderColor: 'var(--primary-subtle, #fed7aa)',
                  backgroundColor: 'var(--primary-light, #fff7ed)',
                  fontWeight: 600,
                  gap: '8px',
                }}
              >
                <Download size={16} />
                <span>Install Smart Bakery App</span>
              </button>
            )}

            {isAuthenticated ? (
              <>
                <div style={{ borderTop: '1px solid var(--border-color)', margin: '0.5rem 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <User size={16} color="var(--primary)" />
                  <strong style={{ fontSize: '0.9rem' }}>{user?.name || user?.email}</strong>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--primary-light)',
                      color: 'var(--primary-dark)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {getRoleLabel()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn btn-outline btn-sm"
                  style={{ color: 'var(--danger)', width: '100%', justifyContent: 'center' }}
                >
                  <LogOut size={16} />
                  <span>Sign out</span>
                </button>
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Link to="/login" className="btn btn-outline btn-sm" onClick={close} style={{ justifyContent: 'center' }}>
                  Sign in
                </Link>
                <Link to="/register" className="btn btn-primary btn-sm" onClick={close} style={{ justifyContent: 'center' }}>
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
