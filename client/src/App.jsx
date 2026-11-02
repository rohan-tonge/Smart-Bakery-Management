import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { PwaProvider } from './context/PwaContext';

// Common Components
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import StorefrontRoute from './components/StorefrontRoute';
import PageTransition from './components/PageTransition';
import OfflineBanner from './components/pwa/OfflineBanner';
import PwaInstallBanner from './components/pwa/PwaInstallBanner';
import PwaUpdateBanner from './components/pwa/PwaUpdateBanner';

// Public Customer Pages
import Home from './pages/public/Home';
import ProductDetail from './pages/public/ProductDetail';
import CartPage from './pages/public/CartPage';
import CheckoutPage from './pages/public/CheckoutPage';
import ManualUpiPayment from './pages/public/ManualUpiPayment';
import OrderTrackingPage from './pages/public/OrderTrackingPage';

// Auth Pages
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';

// Role Dashboards
import CustomerDashboard from './pages/customer/CustomerDashboard';
import OwnerManagerDashboard from './pages/owner/OwnerManagerDashboard';
import ProductionStaffDashboard from './pages/production/ProductionStaffDashboard';

function ManagerRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/owner', search: location.search }} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <PwaProvider>
          <AuthProvider>
            <CartProvider>
              <ToastProvider>
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', minWidth: 0 }}>
                  <OfflineBanner />
                  <Navbar />

                <main style={{ flex: 1, minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
                  <PageTransition>
                    <Routes>
                {/* Public Customer Routes (No Login Required) */}
                <Route path="/" element={<StorefrontRoute><Home /></StorefrontRoute>} />
                <Route path="/product/:id" element={<StorefrontRoute><ProductDetail /></StorefrontRoute>} />
                <Route path="/cart" element={<StorefrontRoute><CartPage /></StorefrontRoute>} />
                <Route path="/checkout" element={<StorefrontRoute><CheckoutPage /></StorefrontRoute>} />
                <Route path="/payment-upi/:orderId" element={<StorefrontRoute><ManualUpiPayment /></StorefrontRoute>} />
                <Route path="/track" element={<StorefrontRoute><OrderTrackingPage /></StorefrontRoute>} />

                {/* Authentication Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />

                {/* Customer Dashboard */}
                <Route
                  path="/customer/*"
                  element={
                    <ProtectedRoute allowedRoles={['CUSTOMER']}>
                      <CustomerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/customer"
                  element={
                    <ProtectedRoute allowedRoles={['CUSTOMER']}>
                      <CustomerDashboard />
                    </ProtectedRoute>
                  }
                />

                {/* Owner / Manager Dashboard (Combined Single Role) */}
                <Route
                  path="/owner/*"
                  element={
                    <ProtectedRoute allowedRoles={['OWNER_MANAGER', 'OWNER', 'MANAGER']}>
                      <OwnerManagerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/owner"
                  element={
                    <ProtectedRoute allowedRoles={['OWNER_MANAGER', 'OWNER', 'MANAGER']}>
                      <OwnerManagerDashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/manager/*"
                  element={<ManagerRedirect />}
                />
                <Route
                  path="/manager"
                  element={<ManagerRedirect />}
                />

                {/* Production Staff Dashboard */}
                <Route
                  path="/production/*"
                  element={
                    <ProtectedRoute allowedRoles={['PRODUCTION_STAFF']}>
                      <ProductionStaffDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/production"
                  element={
                    <ProtectedRoute allowedRoles={['PRODUCTION_STAFF']}>
                      <ProductionStaffDashboard />
                    </ProtectedRoute>
                  }
                />

                {/* Backward compatibility redirects for old URLs */}
                <Route path="/dashboard" element={<Navigate to="/owner" replace />} />

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </PageTransition>
          </main>

          <Footer />
          <PwaInstallBanner />
          <PwaUpdateBanner />
        </div>
      </ToastProvider>
    </CartProvider>
  </AuthProvider>
</PwaProvider>
</ThemeProvider>
</BrowserRouter>
  );
}
