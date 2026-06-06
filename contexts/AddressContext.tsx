import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Address } from '../types';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

interface AddressContextType {
  addresses: Address[];
  isLoading: boolean;
  addAddress: (address: Omit<Address, 'id'>) => Promise<Address | null>;
  updateAddress: (id: string, address: Partial<Omit<Address, 'id'>>) => Promise<void>;
  deleteAddress: (id: string) => Promise<void>;
  reloadAddresses: () => Promise<void>;
}

const AddressContext = createContext<AddressContextType | undefined>(undefined);

export const AddressProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isLoading: isAuthLoading } = useAuth();

  const reloadAddresses = async () => {
    if (!user) {
      setAddresses([]);
      setIsLoading(false);
      return;
    }
    try {
      const data = await api.getAddresses();
      setAddresses(data);
    } catch (error) {
      console.error('Failed to fetch addresses', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthLoading) return;
    reloadAddresses();
  }, [user?.id, isAuthLoading]);

  const addAddress = async (address: Omit<Address, 'id'>): Promise<Address | null> => {
    if (!user) return null;
    try {
      const created = await api.addAddress(address);
      setAddresses((prev) => [created, ...prev]);
      return created;
    } catch (error) {
      console.error('Failed to add address', error);
      return null;
    }
  };

  const updateAddress = async (id: string, updatedFields: Partial<Omit<Address, 'id'>>) => {
    if (!user) return;
    const prev = addresses;
    setAddresses((current) => current.map((addr) => (addr.id === id ? { ...addr, ...updatedFields } : addr)));
    try {
      await api.updateAddress(id, updatedFields);
    } catch (error) {
      console.error('Failed to update address', error);
      setAddresses(prev);
    }
  };

  const deleteAddress = async (id: string) => {
    if (!user) return;
    const prev = addresses;
    setAddresses((current) => current.filter((addr) => addr.id !== id));
    try {
      await api.deleteAddress(id);
    } catch (error) {
      console.error('Failed to delete address', error);
      setAddresses(prev);
    }
  };

  return (
    <AddressContext.Provider
      value={{ addresses, isLoading, addAddress, updateAddress, deleteAddress, reloadAddresses }}
    >
      {children}
    </AddressContext.Provider>
  );
};

export const useAddresses = () => {
  const context = useContext(AddressContext);
  if (!context) {
    throw new Error('useAddresses must be used within an AddressProvider');
  }
  return context;
};
