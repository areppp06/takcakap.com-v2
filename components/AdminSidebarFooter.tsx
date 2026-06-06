import React from 'react';
import { useAuth } from '../contexts/AuthContext';

type AdminSidebarFooterProps = {
  onLogout: () => void;
};

const AdminSidebarFooter: React.FC<AdminSidebarFooterProps> = ({ onLogout }) => {
  const { user } = useAuth();
  const adminName = String(user?.name || '').trim() || 'Administrator';
  const adminRole = user?.role === 'admin' ? 'Administrator' : 'Staff';
  const adminAvatar = String(user?.avatar || '').trim();

  return (
    <div className="p-4 mt-auto border-t border-primary/10">
      <div className="flex items-center gap-3 p-2">
        <div className="size-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
          {adminAvatar ? (
            <img className="w-full h-full object-cover" src={adminAvatar} alt={adminName} />
          ) : (
            <span className="material-symbols-outlined text-primary">person</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{adminName}</p>
          <p className="text-xs text-slate-500 truncate">{adminRole}</p>
        </div>
      </div>
      <button
        onClick={onLogout}
        className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="material-symbols-outlined text-base">logout</span>
        Logout
      </button>
    </div>
  );
};

export default AdminSidebarFooter;
