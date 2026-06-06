import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { useAuth } from '../contexts/AuthContext';
import AppHeader, { HeaderAvatarLink, HeaderCartLink } from '../components/AppHeader';
import UserMobileTabBar from '../components/UserMobileTabBar';
import { useCart } from '../contexts/CartContext';

type NoticeType = 'success' | 'error';

const ManageAccount: React.FC = () => {
  const { user, logout, updateProfile, isAuthenticated } = useAuth();
  const { cartCount } = useCart();
  const activeUser = user || currentUser;
  const [formData, setFormData] = useState({
    name: activeUser.name,
    email: activeUser.email,
    phoneNumber: activeUser.phoneNumber || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null);

  useEffect(() => {
    setFormData({
      name: activeUser.name,
      email: activeUser.email,
      phoneNumber: activeUser.phoneNumber || ''
    });
  }, [activeUser.name, activeUser.email, activeUser.phoneNumber]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const handleSave = async () => {
      try {
          setIsSaving(true);
          await updateProfile({
              name: formData.name,
              phoneNumber: formData.phoneNumber
          });
          setNotice({ message: 'Profile updated successfully', type: 'success' });
      } catch (error: any) {
          setNotice({ message: error?.message || 'Failed to update profile', type: 'error' });
      } finally {
          setIsSaving(false);
      }
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white">
      <AppHeader
        containerClassName="px-4 md:px-10"
        maxWidthClassName="max-w-[1440px]"
        rightContent={
          <>
            <HeaderCartLink cartCount={cartCount} />
            <HeaderAvatarLink isAuthenticated={isAuthenticated} avatarUrl={activeUser.avatar} />
          </>
        }
      />

      <div className="flex flex-1 max-w-[1440px] mx-auto w-full px-4 md:px-10 pt-28 sm:pt-32 pb-24 lg:pb-8 gap-6 md:gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 gap-6">
           <div className="bg-white dark:bg-white/5 rounded-xl p-6 shadow-sm border border-[#e7f4e7] dark:border-white/10 sticky top-24">
             <div className="flex flex-col gap-4">
               <Link to="/dashboard" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">grid_view</span>
                 <span className="text-sm font-medium">Dashboard</span>
               </Link>
               <Link to="/orders" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">receipt_long</span>
                 <span className="text-sm font-medium">Order History</span>
               </Link>
               <Link to="/addresses" className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#e7f4e7] dark:hover:bg-white/5 transition-colors">
                 <span className="material-symbols-outlined">location_on</span>
                 <span className="text-sm font-medium">Saved Addresses</span>
               </Link>
               <Link to="/account" className="flex items-center gap-3 p-2 rounded-lg bg-primary text-[#0d1c0d] font-bold">
                 <span className="material-symbols-outlined">person</span>
                 <span className="text-sm">Manage Account</span>
               </Link>
             </div>
             <div className="mt-8 pt-8 border-t border-[#e7f4e7] dark:border-white/10">
                <button onClick={logout} className="flex items-center gap-3 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg w-full transition-colors">
                   <span className="material-symbols-outlined">logout</span>
                   <span className="text-sm font-medium">Log Out</span>
                </button>
             </div>
           </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col gap-5 sm:gap-6 min-w-0">
            {notice && (
              <div
                className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                  notice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
                role="status"
                aria-live="polite"
              >
                {notice.message}
              </div>
            )}

            <h1 className="text-xl sm:text-2xl font-bold">Manage Account</h1>

            <div className="bg-white dark:bg-white/5 rounded-xl p-4 sm:p-6 md:p-8 border border-[#e7f4e7] dark:border-white/10 shadow-sm max-w-2xl">
                 <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 mb-8">
                     <div className="size-20 rounded-full bg-primary/20 border-2 border-primary overflow-hidden shrink-0">
                        <img className="w-full h-full object-cover" src={activeUser.avatar} alt="User" />
                     </div>
                 </div>

                 <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-semibold mb-1">Username</label>
                        <input 
                          type="text" 
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-semibold mb-1">Email Address</label>
                        <input 
                          type="email" 
                          disabled
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-100 dark:bg-zinc-800/50 text-gray-500 cursor-not-allowed"
                          value={formData.email}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-1">Phone Number</label>
                        <input 
                          type="tel" 
                          className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          value={formData.phoneNumber}
                          onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                          placeholder="+60 12-345 6789"
                        />
                    </div>
                 </div>

                 <div className="mt-8 pt-6 border-t border-[#e7f4e7] dark:border-white/10 flex justify-end">
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full sm:w-auto px-8 py-3 bg-primary text-background-dark font-bold rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-all shadow-lg shadow-primary/20"
                     >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                     </button>
                 </div>

                 <div className="mt-4 pt-4 border-t border-[#e7f4e7] dark:border-white/10 lg:hidden">
                    <button
                      onClick={logout}
                      className="w-full px-4 py-3 rounded-xl border border-red-200 text-red-600 bg-red-50/70 dark:bg-red-900/20 dark:border-red-900/30 dark:text-red-400 font-semibold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                      Log Out
                    </button>
                 </div>
            </div>
        </main>
      </div>
      <UserMobileTabBar />
    </div>
  );
};

export default ManageAccount;
