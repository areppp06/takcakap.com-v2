import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Category } from '../types';
import { api } from '../services/api';

interface CategoryContextType {
  categories: Category[];
  isLoading: boolean;
  addCategory: (name: string, icon: string) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (startIndex: number, endIndex: number) => Promise<void>;
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

export const CategoryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Initial Load
  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const data = await api.getCategories();
      setCategories(data);
    } catch (error) {
      console.error("Failed to fetch categories", error);
    } finally {
      setIsLoading(false);
    }
  };

  const addCategory = async (name: string, icon: string) => {
    // Optimistic Update is risky with generated IDs, so we wait for response or simple optimistic
    try {
      await api.addCategory(name, icon);
      await loadCategories(); // Refresh to get the real ID
    } catch (error) {
      console.error("Failed to add category", error);
    }
  };

  const updateCategory = async (id: string, updates: Partial<Category>) => {
    setCategories(prev => prev.map(cat => cat.id === id ? { ...cat, ...updates } : cat));
    try {
      await api.updateCategory(id, updates);
    } catch (error) {
      console.error("Failed to update category", error);
      loadCategories(); // Revert
    }
  };

  const deleteCategory = async (id: string) => {
    setCategories(prev => prev.filter(cat => cat.id !== id));
    try {
      await api.deleteCategory(id);
    } catch (error) {
      console.error("Failed to delete category", error);
      loadCategories(); // Revert
    }
  };

  const reorderCategories = async (startIndex: number, endIndex: number) => {
    const newOrder = Array.from(categories);
    const [removed] = newOrder.splice(startIndex, 1);
    newOrder.splice(endIndex, 0, removed);
    
    setCategories(newOrder);

    try {
      await api.reorderCategories(newOrder);
    } catch (error) {
      console.error("Failed to reorder", error);
      loadCategories();
    }
  };

  return (
    <CategoryContext.Provider value={{ categories, isLoading, addCategory, updateCategory, deleteCategory, reorderCategories }}>
      {children}
    </CategoryContext.Provider>
  );
};

export const useCategories = () => {
  const context = useContext(CategoryContext);
  if (!context) {
    throw new Error('useCategories must be used within a CategoryProvider');
  }
  return context;
};