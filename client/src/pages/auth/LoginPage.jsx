import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Lock, Mail, AlertCircle, ArrowRight, Croissant } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const user = await login(email, password);

      // Redirect based on previous location if authorized, otherwise default role dashboard
      const role = user?.role;
      const fromLocation = location.state?.from;
      const fromPath = fromLocation ? (fromLocation.pathname + (fromLocation.search || '')) : null;

      if (fromPath && !fromPath.startsWith('/login') && !fromPath.startsWith('/register')) {
        const isOwnerRole = role === 'OWNER_MANAGER' || role === 'OWNER' || role === 'MANAGER';
        const isStaffRole = role === 'PRODUCTION_STAFF';
        if (isOwnerRole && (fromPath.startsWith('/owner') || fromPath.startsWith('/manager'))) {
          navigate(fromPath, { replace: true });
          return;
        }
        if (isStaffRole && fromPath.startsWith('/production')) {
          navigate(fromPath, { replace: true });
          return;
        }
        if (role === 'CUSTOMER' && fromPath.startsWith('/customer')) {
          navigate(fromPath, { replace: true });
          return;
        }
      }

      if (role === 'OWNER_MANAGER' || role === 'OWNER' || role === 'MANAGER') {
        navigate('/owner', { replace: true });
      } else if (role === 'PRODUCTION_STAFF') {
        navigate('/production', { replace: true });
      } else {
        navigate('/customer', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container auth-page" style={{ padding: '3.5rem 1.5rem 5rem 1.5rem', maxWidth: '460px' }}>
      <div className="card" style={{ padding: '2.5rem 2rem', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 1rem auto',
            }}
          >
            <Croissant size={28} />
          </div>

          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '0 0 0.4rem 0', color: 'var(--text-main)' }}>
            Welcome Back
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Sign in to access your orders, management, or kitchen workstation
          </p>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem', animation: 'alertSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label htmlFor="login-email" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
              Email Address
            </label>
            <div style={{ position: 'relative' }}>
              <Mail
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                id="login-email"
                type="email"
                required
                className="input-field"
                placeholder="name@bakery.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ paddingLeft: '38px', margin: 0 }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                id="login-password"
                type="password"
                required
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: '38px', margin: 0 }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-lg"
            style={{
              width: '100%',
              marginTop: '0.5rem',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.75rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 700 }}>
            Register as Customer
          </Link>
        </div>

        <div
          style={{
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          <strong>Guest Ordering:</strong> You do not need an account to browse, place orders, or pay via bakery UPI QR.
        </div>
      </div>
    </div>
  );
}
