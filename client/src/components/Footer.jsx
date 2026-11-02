import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, MapPin, ShieldCheck, QrCode, Croissant, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const CURRENT_YEAR = new Date().getFullYear();

export default function Footer() {
  const { role } = useAuth();
  if (role && !['CUSTOMER'].includes(role)) return null;

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-grid">
          {/* Brand Info */}
          <div>
            <div className="brand-logo" style={{ marginBottom: '1rem' }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(234, 88, 12, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)',
                }}
              >
                <Croissant size={20} />
              </div>
              <span className="brand-name" style={{ color: '#ffffff' }}>Smart Bakery</span>
            </div>
            <p style={{ color: '#a8a29e', fontSize: '0.88rem', lineHeight: '1.6', maxWidth: '320px' }}>
              Handcrafted daily with organic flour, wild levain, and slow fermentation. Fresh sourdoughs, viennoiseries, and pastries made in small artisanal batches.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1rem', color: '#f59e0b', fontSize: '0.82rem', fontWeight: 600 }}>
              <Sparkles size={15} />
              <span>Baking batches daily from 6:00 AM</span>
            </div>
          </div>

          {/* Operating Hours */}
          <div>
            <h4>Bakery Hours & Location</h4>
            <div style={{ color: '#a8a29e', fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Clock size={16} color="var(--primary)" />
                <span>Monday – Saturday: 7:00 AM – 9:00 PM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Clock size={16} color="var(--primary)" />
                <span>Sunday: 8:00 AM – 7:00 PM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <MapPin size={16} color="var(--primary)" />
                <span>Bakery Avenue, Food District</span>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4>Quick Links</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.88rem' }}>
              <li>
                <Link to="/" style={{ color: '#a8a29e', textDecoration: 'none' }}>Fresh Daily Menu</Link>
              </li>
              <li>
                <Link to="/track" style={{ color: '#a8a29e', textDecoration: 'none' }}>Live Order Tracking</Link>
              </li>
              <li>
                <Link to="/cart" style={{ color: '#a8a29e', textDecoration: 'none' }}>My Basket</Link>
              </li>
              <li>
                <Link to="/login" style={{ color: '#a8a29e', textDecoration: 'none' }}>Staff / Owner Portal</Link>
              </li>
            </ul>
          </div>

          {/* Zero Fee Direct UPI Notice */}
          <div>
            <h4>Zero-Fee Direct Payment</h4>
            <div style={{ color: '#a8a29e', fontSize: '0.86rem', lineHeight: '1.5' }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <QrCode size={18} color="var(--primary)" />
                <span style={{ color: '#e7e5e4' }}>Direct UPI QR Payments</span>
              </p>
              <p style={{ color: '#a8a29e', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                Pay safely using Google Pay, PhonePe, Paytm, or BHIM directly to the bakery with no gateway markups.
              </p>
              <p style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#86efac', fontWeight: 600 }}>
                <ShieldCheck size={16} />
                <span>Direct Bakery Kitchen Verification</span>
              </p>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {CURRENT_YEAR} Smart Bakery. All rights reserved. Artisan Food Management Platform.</p>
        </div>
      </div>
    </footer>
  );
}
