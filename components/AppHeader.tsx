import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';

type AppHeaderProps = {
  rightContent?: React.ReactNode;
  maxWidthClassName?: string;
  containerClassName?: string;
};

type HeaderAvatarLinkProps = {
  isAuthenticated: boolean;
  avatarUrl?: string;
};

type HeaderCartLinkProps = {
  cartCount: number;
};

export const HeaderAvatarLink: React.FC<HeaderAvatarLinkProps> = ({ isAuthenticated, avatarUrl }) => (
  <Link
    to={isAuthenticated ? '/dashboard' : '/login'}
    aria-label={isAuthenticated ? 'Go to dashboard' : 'Go to login'}
    className="flex items-center justify-center size-10 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 transition-colors overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
  >
    {isAuthenticated && avatarUrl ? (
      <img className="w-full h-full object-cover" src={avatarUrl} alt="Profile" />
    ) : (
      <span className="material-symbols-outlined text-2xl">person</span>
    )}
  </Link>
);

export const HeaderCartLink: React.FC<HeaderCartLinkProps> = ({ cartCount }) => (
  <Link
    to="/checkout"
    aria-label="Go to checkout"
    className="relative flex items-center justify-center size-10 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
  >
    <span className="material-symbols-outlined text-2xl">shopping_cart</span>
    {cartCount > 0 && (
      <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-background-dark border-2 border-white">
        {cartCount}
      </span>
    )}
  </Link>
);

const AppHeader: React.FC<AppHeaderProps> = ({
  rightContent,
  maxWidthClassName = 'max-w-[1200px]',
  containerClassName = 'px-4'
}) => (
  <div className={`fixed top-6 left-0 right-0 z-50 flex justify-center ${containerClassName}`}>
    <header className={`w-full ${maxWidthClassName} bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border border-white/20 dark:border-white/10 shadow-lg rounded-full flex items-center justify-between min-h-[72px] sm:min-h-[84px] px-4 sm:px-6 py-2 sm:py-3`}>
      <Link
        to="/"
        aria-label="Go to home"
        className="flex items-center min-w-[88px] sm:min-w-[122px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
      >
        <BrandLogo
          alt="Brand logo"
          className="h-[35px] w-[88px] sm:h-[48px] sm:w-[122px] object-contain object-left"
          fallbackIcon="restaurant"
          fallbackIconClassName="material-symbols-outlined block text-4xl text-primary font-bold"
        />
      </Link>
      <div className="flex items-center gap-4">{rightContent}</div>
    </header>
  </div>
);

export default AppHeader;
