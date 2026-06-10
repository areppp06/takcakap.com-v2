import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';

type AdminMobileNavProps = {
  currentPath: string;
  onLogout: () => void;
};

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { to: '/admin/orders', label: 'Orders', icon: 'receipt_long' },
  { to: '/admin/categories', label: 'Categories', icon: 'category' },
  { to: '/admin/menu', label: 'Menus', icon: 'menu_book' },
  { to: '/admin/delivery-options', label: 'Delivery', icon: 'local_shipping' },
  { to: '/admin/manage-shop', label: 'Manage Shop', icon: 'storefront' },
  { to: '/admin/customers', label: 'Customers', icon: 'groups' },
  { to: '/admin/payment-options', label: 'Payment', icon: 'qr_code_2' },
  { to: '/admin/points', label: 'Points', icon: 'stars' },
  { to: '/admin/vouchers', label: 'Vouchers', icon: 'local_activity' }
];

const AdminMobileNav: React.FC<AdminMobileNavProps> = ({ currentPath, onLogout }) => {
  return (
    <div className="lg:hidden sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-4 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur border-b border-primary/10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <Link
          to="/"
          aria-label="Go to home"
          className="flex items-center gap-2 rounded-full border border-primary/15 bg-white/90 dark:bg-slate-900/80 px-3 py-1.5"
        >
          <BrandLogo
            alt="Brand logo"
            className="h-7 w-auto object-contain"
            fallbackIcon="restaurant"
            fallbackIconClassName="material-symbols-outlined text-primary text-xl"
          />
          <span className="text-xs font-bold tracking-wide text-slate-600 dark:text-slate-300">Admin</span>
        </Link>
        <button
          onClick={onLogout}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
        >
          <span className="material-symbols-outlined text-base leading-none">logout</span>
          Logout
        </button>
      </div>

      <div className="overflow-x-auto">
        <nav className="flex items-center gap-2 min-w-max pr-4">
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-primary text-white shadow-md shadow-primary/25'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700'
                }`}
              >
                <span className="material-symbols-outlined text-sm">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default AdminMobileNav;
