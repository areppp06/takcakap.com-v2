import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import { currentUser } from '../services/mockData';
import AppHeader, { HeaderAvatarLink, HeaderCartLink } from './AppHeader';
import UserMobileTabBar from './UserMobileTabBar';

interface UserDashboardLayoutProps {
  children: React.ReactNode;
}

const UserDashboardLayout: React.FC<UserDashboardLayoutProps> = ({ children }) => {
  const { user, logout, isAuthenticated } = useAuth();
  const { cartCount } = useCart();
  const location = useLocation();
  const activeUser = user || currentUser;

  const navLinks = [
    { path: '/dashboard', icon: 'grid_view', label: 'Dashboard' },
    { path: '/rewards', icon: 'stars', label: 'My Rewards' },
    { path: '/orders', icon: 'receipt_long', label: 'Order History' },
    { path: '/addresses', icon: 'location_on', label: 'Saved Addresses' },
    { path: '/account', icon: 'person', label: 'Manage Account' },
  ];

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

      <div className="flex flex-1 max-w-[1440px] mx-auto w-full px-4 md:px-10 pt-32 pb-24 lg:pb-8 gap-6 md:gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 gap-6">
          <div className="bg-white dark:bg-white/5 rounded-xl p-6 shadow-sm border border-[#e7f4e7] dark:border-white/10 sticky top-24">
            <div className="flex flex-col gap-4">
              {navLinks.map((link) => {
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      isActive 
                        ? 'bg-primary text-[#0d1c0d] font-bold' 
                        : 'hover:bg-[#e7f4e7] dark:hover:bg-white/5 font-medium'
                    }`}
                  >
                    <span className="material-symbols-outlined">{link.icon}</span>
                    <span className="text-sm">{link.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-8 pt-8 border-t border-[#e7f4e7] dark:border-white/10">
              <button 
                onClick={logout} 
                className="flex items-center gap-3 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg w-full transition-colors"
              >
                <span className="material-symbols-outlined">logout</span>
                <span className="text-sm font-medium">Log Out</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col gap-6 md:gap-8 min-w-0">
          {children}
        </main>
      </div>
      <UserMobileTabBar />
    </div>
  );
};

export default UserDashboardLayout;
