import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Category, MenuItem } from '../types';
import { formatCurrency } from '../utils/currency';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';

type MenuCategoryGroup = {
  key: string;
  categoryId: string | null;
  name: string;
  icon?: string;
  items: MenuItem[];
};

type DragPosition = {
  groupKey: string;
  index: number;
};

const UNCATEGORIZED_GROUP_KEY = '__uncategorized__';

const AdminMenu: React.FC = () => {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReordering, setIsReordering] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  const closeModal = () => {
      if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl('');
      }
      setSelectedFile(null);
      setIsModalOpen(false);
  };

  // Drag and Drop refs
  const dragItem = useRef<DragPosition | null>(null);
  const dragOverItem = useRef<DragPosition | null>(null);

  // Form State
  const [formData, setFormData] = useState({
      name: '',
      description: '',
      price: '',
      image: '',
      category_id: '',
      stock: 100,
      isActive: true
  });

  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!editingItem) {
      // For NEW items: defer upload until save to prevent orphaned files in R2 on cancel
      setSelectedFile(file);
      const objectUrl = URL.createObjectURL(file);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(objectUrl);
      setFormData((prev) => ({ ...prev, image: objectUrl }));
    } else {
      // For EDITING items: upload immediately
      setIsUploading(true);
      try {
        const result = await api.uploadImage(file);
        if (result.success && result.url) {
          setFormData((prev) => ({ ...prev, image: result.url }));
        } else {
          throw new Error('Image upload failed');
        }
      } catch (error: any) {
        console.error('[Upload] Error:', error);
        alert(error.message || 'Error uploading file. Make sure Cloudflare R2 is configured.');
      } finally {
        setIsUploading(false);
      }
    }
  };

  const isActive = (path: string) => location.pathname === path;

  const sortItemsByCategory = (sourceItems: MenuItem[]) => {
    const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));

    return [...sourceItems].sort((a, b) => {
      const aCategory = a.category_id || '';
      const bCategory = b.category_id || '';

      const aCategoryOrder = categoryOrder.has(aCategory)
        ? (categoryOrder.get(aCategory) as number)
        : Number.MAX_SAFE_INTEGER;
      const bCategoryOrder = categoryOrder.has(bCategory)
        ? (categoryOrder.get(bCategory) as number)
        : Number.MAX_SAFE_INTEGER;

      if (aCategoryOrder !== bCategoryOrder) {
        return aCategoryOrder - bCategoryOrder;
      }

      const aSortOrder = Number(a.sortOrder ?? 0);
      const bSortOrder = Number(b.sortOrder ?? 0);
      if (aSortOrder !== bSortOrder) {
        return aSortOrder - bSortOrder;
      }

      const aId = Number(a.id);
      const bId = Number(b.id);
      if (Number.isFinite(aId) && Number.isFinite(bId)) {
        return aId - bId;
      }
      return String(a.id).localeCompare(String(b.id));
    });
  };

  const groupedItems = useMemo<MenuCategoryGroup[]>(() => {
    const sorted = sortItemsByCategory(items);
    const groupedMap = new Map<string, MenuItem[]>();

    for (const item of sorted) {
      const key = item.category_id || UNCATEGORIZED_GROUP_KEY;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, []);
      }
      groupedMap.get(key)?.push(item);
    }

    const groups: MenuCategoryGroup[] = [];

    for (const category of categories) {
      const categoryItems = groupedMap.get(category.id) || [];
      if (categoryItems.length === 0) continue;

      groups.push({
        key: category.id,
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        items: categoryItems
      });
      groupedMap.delete(category.id);
    }

    const uncategorizedItems = groupedMap.get(UNCATEGORIZED_GROUP_KEY) || [];
    if (uncategorizedItems.length > 0) {
      groups.push({
        key: UNCATEGORIZED_GROUP_KEY,
        categoryId: null,
        name: 'Uncategorized',
        icon: 'label',
        items: uncategorizedItems
      });
      groupedMap.delete(UNCATEGORIZED_GROUP_KEY);
    }

    for (const [categoryKey, uncategorizedGroupItems] of groupedMap.entries()) {
      if (uncategorizedGroupItems.length === 0) continue;
      groups.push({
        key: categoryKey,
        categoryId: categoryKey,
        name: uncategorizedGroupItems[0].category || 'Uncategorized',
        icon: 'label',
        items: uncategorizedGroupItems
      });
    }

    return groups;
  }, [items, categories]);

  // Load Data
  const loadData = async () => {
      setIsLoading(true);
      try {
          const [menuData, catData] = await Promise.all([
              api.getMenu(),
              api.getCategories()
          ]);
          setItems(menuData);
          setCategories(catData);
      } catch (e) {
          console.error('Failed to load data', e);
      } finally {
          setIsLoading(false);
      }
  };

  useEffect(() => {
      loadData();
  }, []);

  const handleOpenModal = (item?: MenuItem) => {
      if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl('');
      }
      setSelectedFile(null);

      if (item) {
          setEditingItem(item);
          const resolvedCategoryId =
            item.category_id || (categories.find(c => c.name === item.category)?.id) || '';

          setFormData({
              name: item.name,
              description: item.description,
              price: item.price.toString(),
              image: item.image,
              category_id: resolvedCategoryId,
              stock: item.stock,
              isActive: item.isActive
          });
      } else {
          setEditingItem(null);
          setFormData({
              name: '',
              description: '',
              price: '',
              image: 'https://source.unsplash.com/random/400x400/?food',
              category_id: categories.length > 0 ? categories[0].id : '',
              stock: 100,
              isActive: true
          });
      }
      setIsModalOpen(true);
  };

  const handleSave = async () => {
      if (!formData.name || !formData.price || !formData.category_id) {
          alert('Please fill in required fields');
          return;
      }

      // Find the category name to ensure strict Type compatibility
      const selectedCategory = categories.find(c => c.id === formData.category_id);
      const categoryName = selectedCategory ? selectedCategory.name : 'Uncategorized';

      const normalizedStock = Math.max(0, Math.floor(Number(formData.stock) || 0));
      
      let finalImageUrl = formData.image;
      if (!editingItem && selectedFile) {
          setIsUploading(true);
          try {
              const result = await api.uploadImage(selectedFile);
              if (result.success && result.url) {
                  finalImageUrl = result.url;
              } else {
                  throw new Error('Image upload failed');
              }
          } catch (error: any) {
              console.error('[Save/Upload] Error:', error);
              alert(error.message || 'Error uploading image to R2 on save.');
              setIsUploading(false);
              return;
          } finally {
              setIsUploading(false);
          }
      }

      const payload = {
          name: formData.name,
          description: formData.description,
          price: parseFloat(formData.price),
          image: finalImageUrl,
          category_id: formData.category_id,
          stock: normalizedStock,
          isActive: formData.isActive,
          category: categoryName
      };

      try {
          if (editingItem) {
              await api.updateMenuItem(editingItem.id, payload);
          } else {
              await api.addMenuItem(payload);
          }
          closeModal();
          await loadData();
      } catch (e) {
          console.error('Save failed', e);
          alert('Failed to save item');
      }
  };

  const handleDelete = async (id: string) => {
      if(window.confirm('Are you sure you want to delete this item?')) {
          try {
              await api.deleteMenuItem(id);
              await loadData();
          } catch(e) {
              alert('Failed to delete');
          }
      }
  };

  const reorderWithinCategory = async (groupKey: string, startIndex: number, endIndex: number) => {
      const group = groupedItems.find((entry) => entry.key === groupKey);
      if (!group) return;
      if (startIndex === endIndex) return;

      const reorderedGroupItems = [...group.items];
      const [movedItem] = reorderedGroupItems.splice(startIndex, 1);
      reorderedGroupItems.splice(endIndex, 0, movedItem);

      const sortOrderById = new Map(reorderedGroupItems.map((item, index) => [item.id, index]));
      const previousItems = items;
      const nextItems = items.map((item) => {
        if (!sortOrderById.has(item.id)) return item;
        return {
          ...item,
          sortOrder: sortOrderById.get(item.id)
        };
      });

      setItems(nextItems);
      setIsReordering(true);
      try {
          const payloadOrder = sortItemsByCategory(nextItems).map((item) => ({
            id: item.id,
            category_id: item.category_id || null
          }));
          await api.reorderMenuItems(payloadOrder);
          await loadData();
      } catch (error) {
          console.error('Failed to reorder menu', error);
          setItems(previousItems);
          alert('Failed to reorder menu items');
      } finally {
          setIsReordering(false);
      }
  };

  const handleDragStart = (e: React.DragEvent<HTMLTableRowElement>, groupKey: string, index: number) => {
    dragItem.current = { groupKey, index };
    e.currentTarget.classList.add('opacity-60', 'border-primary');
  };

  const handleDragEnter = (groupKey: string, index: number) => {
    dragOverItem.current = { groupKey, index };
  };

  const handleDragEnd = async (e: React.DragEvent<HTMLTableRowElement>) => {
    e.currentTarget.classList.remove('opacity-60', 'border-primary');

    const dragged = dragItem.current;
    const draggedOver = dragOverItem.current;
    dragItem.current = null;
    dragOverItem.current = null;

    if (!dragged || !draggedOver) return;
    if (dragged.groupKey !== draggedOver.groupKey) return;

    await reorderWithinCategory(dragged.groupKey, dragged.index, draggedOver.index);
  };

  const handleLogout = () => {
      logout();
      navigate('/admin/login', { replace: true });
  };

  const moveItemInCategory = async (groupKey: string, currentIndex: number, direction: -1 | 1) => {
    if (isReordering) return;
    const targetIndex = currentIndex + direction;
    await reorderWithinCategory(groupKey, currentIndex, targetIndex);
  };

  return (
    <div className="flex min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-white">
       {/* Sidebar */}
       <aside className="hidden lg:flex w-64 border-r border-primary/10 bg-white dark:bg-background-dark/50 flex-col fixed h-full z-20">
          <Link to="/" aria-label="Go to home" className="p-6 flex items-center justify-center">
             <BrandLogo
               alt="Brand logo"
               className="h-10 w-10 object-contain"
               fallbackIcon="restaurant"
               fallbackIconClassName="material-symbols-outlined text-primary text-4xl"
             />
          </Link>
          <AdminSidebarNav currentPath={location.pathname} />
          <AdminSidebarFooter onLogout={handleLogout} />
       </aside>

       {/* Main Content */}
       <main className="lg:ml-64 flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto pb-24 lg:pb-8">
          <AdminMobileNav currentPath={location.pathname} onLogout={handleLogout} />
          <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
             <div>
                <h2 className="text-3xl font-extrabold tracking-tight">Menu Items</h2>
                <p className="text-slate-500">Manage your food & drink catalog by category. Use arrows on mobile or drag rows on desktop to reorder.</p>
             </div>
             <button
                onClick={() => handleOpenModal()}
                disabled={isReordering}
                className="w-full justify-center bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-primary/20 disabled:opacity-70 sm:w-auto"
             >
                 <span className="material-symbols-outlined">add</span>
                 Add Item
             </button>
          </header>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
             <div className="px-6 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40 text-xs font-semibold text-gray-600 dark:text-gray-300">
               {isReordering ? 'Saving menu order...' : 'Organized by category. Reorder items within the same category.'}
             </div>
             <div className="lg:hidden p-4 space-y-4">
               {isLoading ? (
                 <div className="rounded-xl border border-gray-100 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                   Loading menu...
                 </div>
               ) : groupedItems.length === 0 ? (
                 <div className="rounded-xl border border-gray-100 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                   No menu items yet.
                 </div>
               ) : (
                 groupedItems.map((group) => (
                   <section key={`mobile-${group.key}`} className="rounded-xl border border-gray-100 dark:border-slate-700 overflow-hidden">
                     <div className="px-4 py-3 bg-gray-50 dark:bg-slate-700/30 flex items-center justify-between gap-3">
                       <div className="flex items-center gap-2 min-w-0">
                         <span className="material-symbols-outlined text-primary text-lg">{group.icon || 'label'}</span>
                         <p className="font-bold text-sm truncate">{group.name}</p>
                       </div>
                       <span className="text-xs text-slate-500 shrink-0">{group.items.length} items</span>
                     </div>
                     <div className="p-3 space-y-3">
                       {group.items.map((item, index) => (
                         <article key={`mobile-item-${item.id}`} className="rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900/30 p-3">
                           <div className="flex items-start gap-3">
                             <div className="size-14 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                               <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                             </div>
                             <div className="min-w-0 flex-1">
                               <div className="flex items-start justify-between gap-2">
                                 <p className="font-bold text-sm truncate">{item.name}</p>
                                 <p className="text-xs font-bold text-primary whitespace-nowrap">{formatCurrency(item.price)}</p>
                               </div>
                               <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">{item.description}</p>
                               <div className="mt-2 flex flex-wrap items-center gap-2">
                                 <span className={`px-2 py-1 rounded-full text-[10px] font-semibold ${
                                   item.stock > 0
                                     ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                                     : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                                 }`}>
                                   {item.stock > 0 ? `${item.stock} left` : 'Out of stock'}
                                 </span>
                                 <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                                   item.isActive
                                     ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                                     : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
                                 }`}>
                                   {item.isActive ? 'Active' : 'Inactive'}
                                 </span>
                               </div>
                             </div>
                           </div>

                           <div className="mt-3 grid grid-cols-2 gap-2">
                             <button
                               onClick={() => moveItemInCategory(group.key, index, -1)}
                               disabled={isReordering || index === 0}
                               className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                             >
                               <span className="material-symbols-outlined text-sm">arrow_upward</span>
                               Move Up
                             </button>
                             <button
                               onClick={() => moveItemInCategory(group.key, index, 1)}
                               disabled={isReordering || index === group.items.length - 1}
                               className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                             >
                               <span className="material-symbols-outlined text-sm">arrow_downward</span>
                               Move Down
                             </button>
                             <button
                               onClick={() => handleOpenModal(item)}
                               className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 text-primary px-2.5 py-2 text-xs font-bold"
                             >
                               <span className="material-symbols-outlined text-sm">edit</span>
                               Edit
                             </button>
                             <button
                               onClick={() => handleDelete(item.id)}
                               className="flex items-center justify-center gap-1.5 rounded-lg bg-red-50 text-red-600 px-2.5 py-2 text-xs font-bold dark:bg-red-900/20 dark:text-red-300"
                             >
                               <span className="material-symbols-outlined text-sm">delete</span>
                               Delete
                             </button>
                           </div>
                         </article>
                       ))}
                     </div>
                   </section>
                 ))
               )}
             </div>
             <div className="hidden lg:block overflow-x-auto">
             <table className="w-full min-w-[940px] text-left">
                 <thead className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                     <tr>
                         <th className="w-12 px-4 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider"></th>
                         <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Item</th>
                         <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Category</th>
                         <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Price</th>
                         <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Stock</th>
                         <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                         <th className="px-6 py-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-right">Actions</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                     {isLoading ? (
                         <tr><td colSpan={7} className="p-8 text-center">Loading menu...</td></tr>
                     ) : groupedItems.length === 0 ? (
                         <tr><td colSpan={7} className="p-8 text-center text-gray-500">No menu items yet.</td></tr>
                     ) : groupedItems.map((group) => (
                        <React.Fragment key={group.key}>
                          <tr className="bg-gray-50 dark:bg-slate-700/30">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary text-lg">{group.icon || 'label'}</span>
                                <p className="font-bold text-sm text-gray-700 dark:text-gray-200">{group.name}</p>
                                <span className="text-xs text-gray-500">{group.items.length} items</span>
                              </div>
                            </td>
                          </tr>
                          {group.items.map((item, index) => (
                            <tr
                              key={item.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, group.key, index)}
                              onDragEnter={() => handleDragEnter(group.key, index)}
                              onDragOver={(e) => e.preventDefault()}
                              onDragEnd={handleDragEnd}
                              className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors cursor-grab active:cursor-grabbing"
                            >
                                <td className="px-4 py-4 text-center text-gray-300 hover:text-primary">
                                  <span className="material-symbols-outlined">drag_indicator</span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-4">
                                        <div className="size-12 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden">
                                            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm">{item.name}</p>
                                            <p className="text-xs text-gray-400 line-clamp-1 max-w-[200px]">{item.description}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
                                        {group.name}
                                    </span>
                                </td>
                                <td className="px-6 py-4 font-bold text-sm">
                                    {formatCurrency(item.price)}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                        item.stock > 0
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                                            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                                    }`}>
                                        {item.stock > 0 ? `${item.stock} left` : 'Out of stock'}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <div className={`flex items-center gap-1.5 text-xs font-bold ${item.isActive ? 'text-green-500' : 'text-red-500'}`}>
                                        <span className={`size-2 rounded-full ${item.isActive ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                        {item.isActive ? 'Active' : 'Inactive'}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                           onClick={() => handleOpenModal(item)}
                                           className="p-1.5 text-gray-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-lg">edit</span>
                                        </button>
                                        <button
                                           onClick={() => handleDelete(item.id)}
                                           className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-lg">delete</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                          ))}
                        </React.Fragment>
                     ))}
                 </tbody>
             </table>
             </div>
          </div>
       </main>

       {/* Add/Edit Modal */}
       {isModalOpen && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
               <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={closeModal} />
               <div className="relative bg-white dark:bg-zinc-900 w-full max-w-2xl p-6 rounded-2xl shadow-2xl flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
                   <div className="flex justify-between items-center">
                       <h3 className="text-2xl font-bold">{editingItem ? 'Edit Item' : 'New Menu Item'}</h3>
                       <button onClick={closeModal}><span className="material-symbols-outlined">close</span></button>
                   </div>

                   <div className="grid md:grid-cols-2 gap-4">
                       <div className="col-span-2">
                           <label className="block text-sm font-bold mb-1">Item Name</label>
                           <input type="text" className="w-full p-3 rounded-lg border dark:border-slate-700 dark:bg-slate-800" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                       </div>

                       <div className="col-span-2">
                           <label className="block text-sm font-bold mb-1">Description</label>
                           <textarea className="w-full p-3 rounded-lg border dark:border-slate-700 dark:bg-slate-800 h-20" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                       </div>

                       <div>
                           <label className="block text-sm font-bold mb-1">Price (RM)</label>
                           <input type="number" step="0.01" className="w-full p-3 rounded-lg border dark:border-slate-700 dark:bg-slate-800" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                       </div>

                       <div>
                           <label className="block text-sm font-bold mb-1">Stock</label>
                           <input
                             type="number"
                             min="0"
                             className="w-full p-3 rounded-lg border dark:border-slate-700 dark:bg-slate-800"
                             value={formData.stock}
                             onChange={e => setFormData({...formData, stock: Math.max(0, Math.floor(Number(e.target.value) || 0))})}
                           />
                       </div>

                       <div className="col-span-2">
                           <label className="block text-sm font-bold mb-1">Category</label>
                           <select
                             className="w-full p-3 rounded-lg border dark:border-slate-700 dark:bg-slate-800"
                             value={formData.category_id}
                             onChange={e => setFormData({...formData, category_id: e.target.value})}
                           >
                               {categories.map(c => (
                                   <option key={c.id} value={c.id}>{c.name}</option>
                               ))}
                           </select>
                       </div>

                       <div className="col-span-2">
                           <div className="flex justify-between items-center mb-1">
                               <label className="block text-sm font-bold">Image URL / Upload</label>
                               {isUploading && <span className="text-xs text-primary font-bold animate-pulse">Uploading to R2...</span>}
                           </div>
                           <div className="flex gap-2 items-center">
                               <input type="text" placeholder="Paste URL or upload image" className="flex-1 p-3 rounded-lg border dark:border-slate-700 dark:bg-slate-800" value={formData.image} onChange={e => setFormData({...formData, image: e.target.value})} />
                               <label className="cursor-pointer bg-primary/10 hover:bg-primary/20 text-primary px-4 py-3 rounded-lg font-bold text-sm shrink-0 flex items-center gap-1 transition-all select-none">
                                   <span className="material-symbols-outlined text-lg">cloud_upload</span>
                                   Upload
                                   <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
                               </label>
                               <div className="size-12 bg-gray-100 rounded-lg overflow-hidden shrink-0 border border-gray-200 dark:border-slate-700">
                                   <img src={formData.image} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = 'https://placehold.co/100x100?text=No+Image')} />
                               </div>
                           </div>
                       </div>

                       <div className="col-span-2 flex items-center gap-3">
                           <input
                             type="checkbox"
                             id="isActive"
                             className="size-5 rounded text-primary focus:ring-primary"
                             checked={formData.isActive}
                             onChange={e => setFormData({...formData, isActive: e.target.checked})}
                           />
                           <label htmlFor="isActive" className="font-bold cursor-pointer">Available (Active)</label>
                       </div>
                   </div>

                   <div className="flex gap-3 mt-4">
                       <button onClick={closeModal} className="flex-1 py-3 bg-gray-100 dark:bg-slate-800 rounded-xl font-bold">Cancel</button>
                       <button onClick={handleSave} className="flex-1 py-3 bg-primary text-white rounded-xl font-bold">Save Item</button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};

export default AdminMenu;
