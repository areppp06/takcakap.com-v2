import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/rewards', label: 'Rewards', icon: 'stars' },
  { to: '/orders', label: 'Orders', icon: 'receipt_long' },
  { to: '/addresses', label: 'Addresses', icon: 'location_on' },
  { to: '/account', label: 'Account', icon: 'person' }
];

const UserMobileTabBar: React.FC = () => {
  const location = useLocation();
  const pathname = location.pathname;

  const isActive = (to: string) => {
    if (to === '/') return pathname === '/';
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-[80] px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-primary/20 bg-white/95 dark:bg-background-dark/90 backdrop-blur-md shadow-xl shadow-black/5">
        <div className="grid grid-cols-5 gap-1 p-1.5">
          {tabs.map((tab) => {
            const active = isActive(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2.5 transition-colors ${
                  active
                    ? 'bg-primary text-white'
                    : 'text-gray-500 dark:text-gray-300 hover:bg-primary/10'
                }`}
              >
                <span className="material-symbols-outlined text-[20px] leading-none">{tab.icon}</span>
                <span className="text-[11px] font-semibold leading-none">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default UserMobileTabBar;
