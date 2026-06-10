import React, { useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCategories } from '../contexts/CategoryContext';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import AdminMobileNav from '../components/AdminMobileNav';
import AdminSidebarNav from '../components/AdminSidebarNav';
import AdminSidebarFooter from '../components/AdminSidebarFooter';

const ICON_PACK = [
  'restaurant', 'lunch_dining', 'local_pizza', 'bakery_dining', 'icecream', 
  'local_cafe', 'local_bar', 'fastfood', 'ramen_dining', 'kitchen', 
  'nutrition', 'set_meal', 'soup_kitchen', 'egg', 'kebab_dining', 
  'tapas', 'rice_bowl', 'menu_book', 'eco', 'cake', 'liquor',
  'cookie', 'emoji_food_beverage', 'brunch_dining', 'takeout_dining'
];

const AdminCategories: React.FC = () => {
  const { categories, addCategory, updateCategory, deleteCategory, reorderCategories } = useCategories();
  const [isAdding, setIsAdding] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState(ICON_PACK[0]);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Drag and Drop refs
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const isActive = (path: string) => location.pathname === path;

  const handleDragStart = (e: React.DragEvent, position: number) => {
    dragItem.current = position;
    // visual effect for dragging
    e.currentTarget.classList.add('opacity-50', 'border-primary');
  };

  const handleDragEnter = (e: React.DragEvent, position: number) => {
    dragOverItem.current = position;
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-50', 'border-primary');
    
    if (dragItem.current !== null && dragOverItem.current !== null) {
      reorderCategories(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleSaveAdd = () => {
      if(newCategoryName.trim()) {
          addCategory(newCategoryName, newCategoryIcon);
          setNewCategoryName('');
          setNewCategoryIcon(ICON_PACK[0]);
          setIsAdding(false);
      }
  };

  const handleStartEdit = (cat: any) => {
      setEditingId(cat.id);
      setEditName(cat.name);
  };

  const handleSaveEdit = (id: string) => {
      if(editName.trim()) {
          updateCategory(id, { name: editName });
          setEditingId(null);
      }
  };

  const handleDelete = (id: string) => {
      if(window.confirm('Are you sure you want to delete this category?')) {
          deleteCategory(id);
      }
  };
  const handleLogout = () => {
      logout();
      navigate('/admin/login', { replace: true });
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
                <h2 className="text-3xl font-extrabold tracking-tight">Categories</h2>
                <p className="text-slate-500">Manage and reorder your food categories.</p>
             </div>
             <button 
                onClick={() => { setIsAdding(true); setNewCategoryIcon(ICON_PACK[0]); }}
                className="w-full justify-center bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-primary/20 sm:w-auto"
             >
                 <span className="material-symbols-outlined">add</span>
                 Add Category
             </button>
          </header>

          <div className="max-w-3xl">
              {/* Add New Section */}
              {isAdding && (
                  <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border-2 border-primary/20 mb-8 shadow-xl">
                      <div className="flex justify-between items-center mb-6">
                          <h3 className="font-bold text-lg">Create New Category</h3>
                          <button onClick={() => setIsAdding(false)} className="text-gray-400 hover:text-gray-600">
                             <span className="material-symbols-outlined">close</span>
                          </button>
                      </div>

                      {/* Name Input */}
                      <div className="mb-6">
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Category Name</label>
                          <div className="flex items-center gap-4">
                              <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                  <span className="material-symbols-outlined text-primary text-2xl">{newCategoryIcon}</span>
                              </div>
                              <input 
                                autoFocus
                                type="text" 
                                className="flex-1 bg-gray-50 dark:bg-slate-700/50 border-2 border-gray-100 dark:border-slate-700 rounded-xl px-4 py-3 font-semibold focus:outline-none focus:border-primary transition-colors"
                                placeholder="e.g. Sushi, Breakfast, Deals..."
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveAdd()}
                              />
                          </div>
                      </div>

                      {/* Icon Picker */}
                      <div className="mb-8">
                          <label className="block text-xs font-bold uppercase text-gray-400 mb-3">Select Icon</label>
                          <div className="grid grid-cols-7 sm:grid-cols-9 gap-2">
                              {ICON_PACK.map(icon => (
                                  <button
                                    key={icon}
                                    onClick={() => setNewCategoryIcon(icon)}
                                    className={`aspect-square rounded-xl flex items-center justify-center transition-all ${
                                        newCategoryIcon === icon 
                                        ? 'bg-primary text-white shadow-lg scale-110 ring-2 ring-primary ring-offset-2 dark:ring-offset-slate-800' 
                                        : 'bg-gray-50 dark:bg-slate-700/50 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-primary'
                                    }`}
                                    title={icon}
                                  >
                                      <span className="material-symbols-outlined text-xl">{icon}</span>
                                  </button>
                              ))}
                          </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-700">
                          <button onClick={() => setIsAdding(false)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                              Cancel
                          </button>
                          <button onClick={handleSaveAdd} className="px-8 py-2.5 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/25 hover:bg-primary/90 transition-all active:scale-95">
                              Create Category
                          </button>
                      </div>
                  </div>
              )}

              {/* Draggable List */}
              <div className="space-y-3">
                  {categories.map((cat, index) => (
                      <div 
                        key={cat.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnter={(e) => handleDragEnter(e, index)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => e.preventDefault()}
                        className="group bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-all"
                      >
                          <div className="flex items-center gap-3 sm:gap-4 flex-1 w-full">
                              {/* Drag Handle (Desktop) */}
                              <div className="hidden sm:block text-gray-300 hover:text-primary cursor-grab shrink-0">
                                  <span className="material-symbols-outlined">drag_indicator</span>
                              </div>

                              {/* Mobile Up/Down controls */}
                              <div className="flex sm:hidden flex-col gap-1 text-gray-400 shrink-0">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); if(index > 0) reorderCategories(index, index - 1); }} 
                                    disabled={index === 0}
                                    className="hover:text-primary disabled:opacity-30 disabled:hover:text-gray-400"
                                  >
                                      <span className="material-symbols-outlined text-[20px] leading-none">keyboard_arrow_up</span>
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); if(index < categories.length - 1) reorderCategories(index, index + 1); }} 
                                    disabled={index === categories.length - 1}
                                    className="hover:text-primary disabled:opacity-30 disabled:hover:text-gray-400"
                                  >
                                      <span className="material-symbols-outlined text-[20px] leading-none">keyboard_arrow_down</span>
                                  </button>
                              </div>

                              {/* Icon */}
                              <div className="size-10 rounded-lg bg-gray-50 dark:bg-slate-700 flex items-center justify-center shrink-0">
                                  <span className="material-symbols-outlined text-primary">{cat.icon}</span>
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                  {editingId === cat.id ? (
                                      <input 
                                        autoFocus
                                        type="text"
                                        className="w-full bg-transparent border-b-2 border-primary focus:outline-none px-0 py-1 font-bold"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(cat.id)}
                                        onBlur={() => handleSaveEdit(cat.id)}
                                      />
                                  ) : (
                                      <div className="flex flex-col">
                                          <span className="font-bold text-lg truncate">{cat.name}</span>
                                          <span className="text-xs text-gray-400">{cat.itemCount} items linked</span>
                                      </div>
                                  )}
                              </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-slate-700">
                               {/* Toggle Switch */}
                               <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                   <button
                                     onClick={() => {
                                       updateCategory(cat.id, { isActive: cat.isActive === false });
                                     }}
                                     className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                                       cat.isActive !== false ? 'bg-primary animate-none' : 'bg-gray-200 dark:bg-zinc-700'
                                     }`}
                                     title={cat.isActive !== false ? 'Active' : 'Inactive'}
                                   >
                                     <span
                                       className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                                         cat.isActive !== false ? 'translate-x-6' : 'translate-x-1'
                                       }`}
                                     />
                                   </button>
                                   <span className="text-xs font-bold w-12 text-slate-400">
                                       {cat.isActive !== false ? 'Active' : 'Inactive'}
                                    </span>
                               </div>

                              {/* Actions */}
                              <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => handleStartEdit(cat)}
                                    className="p-2 text-gray-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                    title="Rename"
                                  >
                                      <span className="material-symbols-outlined text-xl">edit</span>
                                  </button>
                                  <button 
                                    onClick={() => handleDelete(cat.id)}
                                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    title="Delete"
                                  >
                                      <span className="material-symbols-outlined text-xl">delete</span>
                                  </button>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
       </main>
    </div>
  );
};

export default AdminCategories;
