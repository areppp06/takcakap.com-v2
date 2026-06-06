import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { CartItem, MenuItem } from '../types';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

interface CartContextType {
  cart: CartItem[];
  isLoading: boolean;
  addToCart: (item: MenuItem) => Promise<boolean>;
  removeFromCart: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  cartTotal: number;
  cartCount: number;
  reloadCart: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isLoading: isAuthLoading } = useAuth();

  const reloadCart = async () => {
    if (!user) {
      setCart([]);
      setIsLoading(false);
      return;
    }
    try {
      const data = await api.getCart();
      setCart(data);
    } catch (error) {
      console.error('Failed to fetch cart', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthLoading) return;
    reloadCart();
  }, [user?.id, isAuthLoading]);

  const addToCart = async (item: MenuItem) => {
    if (!user) {
      console.error('Authentication required to add items to cart');
      return false;
    }
    try {
      const updated = await api.addCartItem(item.id, 1);
      setCart(updated);
      return true;
    } catch (error) {
      console.error('Failed to add item to cart', error);
      return false;
    }
  };

  const removeFromCart = async (itemId: string) => {
    if (!user) return;
    const prev = cart;
    setCart((current) => current.filter((i) => i.id !== itemId));
    try {
      const updated = await api.removeCartItem(itemId);
      setCart(updated);
    } catch (error) {
      console.error('Failed to remove cart item', error);
      setCart(prev);
    }
  };

  const updateQuantity = async (itemId: string, quantity: number) => {
    if (!user) return;
    if (quantity < 1) {
      await removeFromCart(itemId);
      return;
    }

    const prev = cart;
    setCart((current) => current.map((i) => (i.id === itemId ? { ...i, quantity } : i)));
    try {
      const updated = await api.updateCartItem(itemId, quantity);
      setCart(updated);
    } catch (error) {
      console.error('Failed to update cart quantity', error);
      setCart(prev);
    }
  };

  const clearCart = async () => {
    if (!user) return;
    const prev = cart;
    setCart([]);
    try {
      await api.clearCart();
    } catch (error) {
      console.error('Failed to clear cart', error);
      setCart(prev);
    }
  };

  const cartTotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const cartCount = cart.reduce((count, item) => count + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        isLoading,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        cartTotal,
        cartCount,
        reloadCart
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
