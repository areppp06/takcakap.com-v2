import React from 'react';
import { Link } from 'react-router-dom';

type AdminSidebarNavProps = {
  currentPath: string;
};

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/orders', label: 'Orders', icon: 'receipt_long' },
  { to: '/categories', label: 'Categories', icon: 'category' },
  { to: '/menu', label: 'Menus', icon: 'menu_book' },
  { to: '/delivery-options', label: 'Delivery', icon: 'local_shipping' },
  { to: '/manage-shop', label: 'Manage Shop', icon: 'storefront' },
  { to: '/customers', label: 'Customers', icon: 'groups' },
  { to: '/payment-options', label: 'Payment', icon: 'payments' },
  { to: '/points', label: 'Points', icon: 'stars' },
  { to: '/vouchers', label: 'Vouchers', icon: 'local_activity' }
];

const AdminSidebarNav: React.FC<AdminSidebarNavProps> = ({ currentPath }) => {
  return (
    <nav className="flex-1 px-4 space-y-2 mt-4">
      {NAV_ITEMS.map((item) => {
        const active =
          item.to === '/'
            ? currentPath === '/' || currentPath === '/admin'
            : currentPath === item.to || currentPath.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-colors ${
              active ? 'bg-primary text-white' : 'hover:bg-primary/10 text-slate-600 dark:text-slate-400'
            }`}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};

export default AdminSidebarNav;
