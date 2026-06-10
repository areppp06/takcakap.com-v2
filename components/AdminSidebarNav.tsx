import React from 'react';
import { Link } from 'react-router-dom';

type AdminSidebarNavProps = {
  currentPath: string;
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

const AdminSidebarNav: React.FC<AdminSidebarNavProps> = ({ currentPath }) => {
  return (
    <nav className="flex-1 px-4 space-y-2 mt-4">
      {NAV_ITEMS.map((item) => {
        const active = currentPath === item.to;
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
