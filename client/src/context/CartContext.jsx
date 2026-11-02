import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { user, role } = useAuth();
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isEligibleForCart = !user || role === 'CUSTOMER';

  const fetchCart = useCallback(async () => {
    if (!isEligibleForCart) {
      setCart(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await api.getCart();
      const cartData = res.data?.cart || res.data || null;
      if (cartData && res.data?.subtotal !== undefined) {
        cartData.subtotal = res.data.subtotal;
      }
      setCart(cartData);
    } catch (err) {
      // 403 or 404 is acceptable for new visitors
      if (err.status !== 403 && err.status !== 404) {
        console.warn('Failed to fetch cart:', err.message);
      }
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, [isEligibleForCart]);

  useEffect(() => {
    fetchCart();
  }, [fetchCart, user]);

  const addToCart = async ({ productId, variantId, quantity = 1, specialInstructions }) => {
    if (!isEligibleForCart) {
      throw new Error('Staff accounts cannot place customer orders');
    }
    const cleanQty = Math.max(1, Math.min(100, Math.round(Number(quantity)) || 1));
    if (!productId || !variantId) {
      throw new Error('Product ID and Variant ID are required to add an item to the basket');
    }
    try {
      setLoading(true);
      setError(null);
      const payload = {
        productId: String(productId).trim(),
        variantId: String(variantId).trim(),
        quantity: cleanQty,
      };
      if (specialInstructions && typeof specialInstructions === 'string' && specialInstructions.trim()) {
        payload.specialInstructions = specialInstructions.trim();
      }
      const res = await api.addToCart(payload);
      const cartData = res.data?.cart || res.data;
      if (cartData && res.data?.subtotal !== undefined) {
        cartData.subtotal = res.data.subtotal;
      }
      setCart(cartData);
      return cartData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = async (itemId, quantity) => {
    const cleanQty = Math.round(Number(quantity));
    if (cleanQty <= 0) {
      return removeItem(itemId);
    }
    try {
      setLoading(true);
      const res = await api.updateCartItem(itemId, { quantity: Math.min(100, cleanQty) });
      const cartData = res.data?.cart || res.data;
      if (cartData && res.data?.subtotal !== undefined) {
        cartData.subtotal = res.data.subtotal;
      }
      setCart(cartData);
      return cartData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (itemId) => {
    try {
      setLoading(true);
      const res = await api.removeCartItem(itemId);
      const cartData = res.data?.cart || res.data;
      if (cartData && res.data?.subtotal !== undefined) {
        cartData.subtotal = res.data.subtotal;
      }
      setCart(cartData);
      return cartData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const clearCart = async () => {
    try {
      setLoading(true);
      await api.clearCart();
      setCart({ items: [], subtotal: 0 });
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const items = cart?.items || [];
  const itemCount = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const totalAmount = cart?.subtotal ?? cart?.totalAmount ?? items.reduce((sum, item) => sum + (item.lineTotal ?? ((item.unitPrice || item.price || 0) * (item.quantity || 1))), 0);

  const value = {
    cart,
    items,
    itemCount,
    totalAmount,
    loading,
    error,
    fetchCart,
    addToCart,
    updateQuantity,
    removeItem,
    clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
