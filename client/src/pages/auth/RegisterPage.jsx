import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Lock, Mail, User, Phone, AlertCircle, ArrowRight, Croissant } from 'lucide-react';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
      });

      navigate('/customer', { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed. Email may already be in use.');
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
            Create Account
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Save delivery addresses and view all past bakery orders
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
            <label htmlFor="reg-name" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
              Full Name
            </label>
            <div style={{ position: 'relative' }}>
              <User
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
                id="reg-name"
                type="text"
                required
                className="input-field"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ paddingLeft: '38px', margin: 0 }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-email" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
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
                id="reg-email"
                type="email"
                required
                className="input-field"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ paddingLeft: '38px', margin: 0 }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-phone" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
              Phone Number (Optional)
            </label>
            <div style={{ position: 'relative' }}>
              <Phone
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
                id="reg-phone"
                type="tel"
                className="input-field"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ paddingLeft: '38px', margin: 0 }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-password" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-main)' }}>
              Password (min 6 characters)
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
                id="reg-password"
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
                <span>Create Customer Account</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.75rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 700 }}>
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
