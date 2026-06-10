import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { useAuth } from '../contexts/AuthContext';
import UserDashboardLayout from '../components/UserDashboardLayout';

type NoticeType = 'success' | 'error';

const ManageAccount: React.FC = () => {
  const { user, logout, updateProfile, isAuthenticated } = useAuth();
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
    <UserDashboardLayout>
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
    </UserDashboardLayout>
  );
};

export default ManageAccount;
