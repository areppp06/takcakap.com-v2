import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { api } from '../services/api';
import { useCart } from '../contexts/CartContext';
import { useCategories } from '../contexts/CategoryContext';
import { useAuth } from '../contexts/AuthContext';
import { MenuItem, ShopStatus } from '../types';
import { formatCurrency } from '../utils/currency';
import AppHeader, { HeaderAvatarLink, HeaderCartLink } from '../components/AppHeader';
import BrandLogo from '../components/BrandLogo';

const formatTimeLabel = (hhmm?: string) => {
  if (!hhmm) return '';
  const parts = hhmm.split(':');
  if (parts.length < 2) return hhmm;
  const h = parseInt(parts[0], 10);
  const m = parts[1];
  if (isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${ampm}`;
};

type NoticeType = 'success' | 'error';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { cartCount, addToCart } = useCart();
  const { categories, isLoading: isCategoriesLoading } = useCategories();
  const { user, isAuthenticated } = useAuth();
  
  const [items, setItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [shopStatus, setShopStatus] = useState<ShopStatus | null>(null);
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null);

  // Load Menu Items from backend API
  useEffect(() => {
    const fetchMenu = async () => {
        try {
            const data = await api.getMenu();
            setItems(data);
        } catch (e) {
            console.error("Failed to load menu", e);
        } finally {
            setIsLoading(false);
        }
    };
    fetchMenu();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadShopStatus = async () => {
      try {
        const status = await api.getShopStatus();
        if (!cancelled) setShopStatus(status);
      } catch (error) {
        console.error('Failed to load shop status', error);
      }
    };

    loadShopStatus();
    const intervalId = window.setInterval(loadShopStatus, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const storefrontItems = useMemo(() => items.filter((item) => item.isActive), [items]);

  const activeCategories = useMemo(() => categories.filter(cat => cat.isActive !== false), [categories]);

  // Filter Logic
  const filteredItems = selectedCategory === 'All' 
    ? storefrontItems
    : storefrontItems.filter(item => item.category === selectedCategory);

  const groupedAllItems = useMemo(() => {
    const groups = activeCategories
      .map((category) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        items: storefrontItems.filter(
          (item) =>
            (item.category_id && item.category_id === category.id) ||
            (!item.category_id && item.category === category.name)
        )
      }))
      .filter((group) => group.items.length > 0);

    const groupedItemIds = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
    const uncategorizedItems = storefrontItems.filter((item) => !groupedItemIds.has(item.id));
    if (uncategorizedItems.length > 0) {
      groups.push({
        id: '__uncategorized__',
        name: 'Uncategorized',
        icon: 'label',
        items: uncategorizedItems
      });
    }

    return groups;
  }, [categories, storefrontItems]);

  const profileAvatar = user?.avatar || currentUser.avatar;
  const greetingName = (user?.name || '').trim() || 'Kawan';
  const currentYear = new Date().getFullYear();
  const paymentMethods = [
    { name: 'TNG eWallet', src: 'https://www.touchngo.com.my/assets/logo-tngewallet.svg', className: 'h-6' },
    { name: 'Visa', src: 'https://down-my.img.susercontent.com/file/735e9b602704f9fcecc0fc589358d5df', className: 'h-6' },
    { name: 'Mastercard', src: 'https://down-my.img.susercontent.com/file/8612df33671e5fcf4e3896dddc09126f', className: 'h-6' },
    { name: 'FPX', src: 'https://down-my.img.susercontent.com/file/be96ecd1fe21e89d006f285bae7db4ee', className: 'h-6' },
    { name: 'DuitNow', src: 'https://down-my.img.susercontent.com/file/2b9fdf2b116defb1373ec0ca833b622e', className: 'h-6' },
    { name: 'Additional Payment', src: 'https://down-my.img.susercontent.com/file/2d504b9eaad31ffb9d9a5070a7f3207b', className: 'h-6' }
  ];

  const handleAddToCart = async (item: MenuItem) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/checkout' } });
      return;
    }
    const added = await addToCart(item);
    if (added) {
      setNotice({ message: `${item.name} added to cart`, type: 'success' });
      return;
    }
    setNotice({ message: 'Failed to add item to cart. Please try again.', type: 'error' });
  };

  const renderMenuCard = (item: MenuItem) => {
    const availableStock = Math.max(0, Number(item.stock || 0));
    const isShopOrderable = shopStatus?.isOrderable ?? true;
    const canPurchase = item.isActive && availableStock > 0 && isShopOrderable;

    return (
    <div key={item.id} className="group bg-white dark:bg-zinc-900 rounded-xl overflow-hidden border border-zinc-100 dark:border-zinc-800 hover:shadow-xl transition-all duration-300">
      <div className="relative aspect-square overflow-hidden">
        <div
          className={`absolute inset-0 bg-center bg-no-repeat bg-cover transition-transform duration-500 group-hover:scale-110 ${!canPurchase ? 'grayscale' : ''}`}
          style={{ backgroundImage: `url("${item.image}")` }}
        ></div>
        {!canPurchase && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
            <span className="bg-red-500 text-white px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wider shadow-lg transform -rotate-12 border-2 border-white">Sold Out</span>
          </div>
        )}
      </div>
      <div className="p-5">
        <div className="flex justify-between items-start mb-2">
          <h3 className={`text-background-dark dark:text-white font-bold text-lg leading-tight ${!canPurchase ? 'text-gray-400 dark:text-gray-500' : ''}`}>{item.name}</h3>
          <span className={`text-primary font-bold text-lg ${!canPurchase ? 'opacity-50' : ''}`}>{formatCurrency(item.price)}</span>
        </div>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-3 line-clamp-2 h-10">{item.description}</p>
        <p className={`text-xs font-semibold mb-5 ${canPurchase ? 'text-emerald-600' : 'text-red-500'}`}>
          {canPurchase ? `${availableStock} left` : !isShopOrderable ? 'Temporarily unavailable' : 'Out of stock'}
        </p>
        <button
          onClick={() => canPurchase && handleAddToCart(item)}
          disabled={!canPurchase}
          className={`w-full font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all transform ${
            canPurchase
              ? 'bg-primary hover:bg-[#cc10c3] text-background-dark active:scale-95'
              : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-gray-500 cursor-not-allowed border border-gray-200 dark:border-zinc-700'
          }`}
        >
          <span className="material-symbols-outlined font-bold">{canPurchase ? 'add' : 'block'}</span>
          {canPurchase ? 'Add to Cart' : 'Sold Out'}
        </button>
      </div>
    </div>
    );
  };

  return (
    <div className="min-h-screen pb-20">
      {notice && (
        <div
          className="fixed top-[110px] sm:top-[124px] left-1/2 -translate-x-1/2 z-[90] w-[calc(100vw-2rem)] max-w-[420px] rounded-full border border-primary/30 bg-white/95 dark:bg-background-dark/90 px-6 py-3 shadow-lg backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-semibold text-center text-background-dark dark:text-white">{notice.message}</p>
        </div>
      )}

      <AppHeader
        maxWidthClassName="max-w-7xl"
        rightContent={
          <>
            <HeaderCartLink cartCount={cartCount} />
            <HeaderAvatarLink isAuthenticated={isAuthenticated} avatarUrl={profileAvatar} />
          </>
        }
      />

      <main className="pt-32 px-4 max-w-7xl mx-auto">
        {/* Hero Text */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-background-dark dark:text-white mb-4">{`Hi ${greetingName}, Nak Makan Apa?`}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-lg">Pickup Kedai bolehh... Lalamove pon boleh...!</p>
        </div>

        {shopStatus && !shopStatus.isOrderable && (
          <div className="mb-8 max-w-3xl mx-auto text-center text-sm font-semibold text-[#0d1c0d] dark:text-white bg-primary/10 border border-primary/30 rounded-xl px-4 py-3">
            {shopStatus.message}
          </div>
        )}

        {/* Category Selector */}
        <div className="mb-10 overflow-x-auto no-scrollbar">
          <div className="inline-flex min-w-max items-center gap-2 px-1 pb-3">
            <button 
              onClick={() => setSelectedCategory('All')}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold shadow-sm transition-all whitespace-nowrap ${
                  selectedCategory === 'All' 
                  ? 'bg-primary text-background-dark' 
                  : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <span className="material-symbols-outlined text-lg">grid_view</span>
              All
            </button>
            
            {isCategoriesLoading ? (
               // Loading Skeletons
               <>
                  {[1,2,3,4].map(i => (
                    <div key={i} className="h-9 w-24 bg-gray-200 dark:bg-zinc-800 rounded-full animate-pulse flex-shrink-0"></div>
                  ))}
               </>
            ) : (
              activeCategories.map((cat) => (
                <button 
                  key={cat.id} 
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-all whitespace-nowrap ${
                      selectedCategory === cat.name
                      ? 'bg-primary text-background-dark border-primary'
                      : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-primary/50'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">{cat.icon}</span>
                  {cat.name}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Product Grid */}
        {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
               {[1,2,3,4,5,6].map(i => (
                   <div key={i} className="h-80 bg-gray-200 dark:bg-zinc-800 rounded-xl animate-pulse"></div>
               ))}
            </div>
        ) : selectedCategory === 'All' ? (
            <div className="space-y-12">
              {groupedAllItems.length === 0 ? (
                <div className="text-center text-zinc-500 py-12">No menu items available.</div>
              ) : (
                groupedAllItems.map((group) => (
                  <section key={group.id} className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">{group.icon || 'label'}</span>
                      <h2 className="text-2xl font-extrabold text-background-dark dark:text-white">{group.name}</h2>
                      <span className="text-sm text-zinc-500">({group.items.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                      {group.items.map((item) => renderMenuCard(item))}
                    </div>
                  </section>
                ))
              )}
            </div>
        ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {filteredItems.map((item) => renderMenuCard(item))}
            </div>
        )}
      </main>

      <footer className="mt-10 border-t border-zinc-200 bg-zinc-50 pt-8 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
        <div className="mx-auto max-w-7xl px-4 pb-10 sm:pb-12">
          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <div className="flex items-center">
                <BrandLogo
                  alt="TakCakap logo"
                  className="h-[42px] w-[132px] object-contain object-left"
                  fallbackIcon="restaurant"
                  fallbackIconClassName="material-symbols-outlined block text-4xl text-primary font-bold"
                />
              </div>
              <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="text-sm font-bold text-background-dark dark:text-white">Address</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {shopStatus?.storeAddress || 'Medan Seleraneka Perda Gerai No.1, 2, Taman IKS Bukit Minyak, Lorong IKS Bukit Minyak 1 Seberang Perai Tengah, Pulau Pinang, 14000'}
                </p>
                <a
                  href="https://maps.app.goo.gl/a317c4eDuQMY9G2L8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  <span className="material-symbols-outlined text-base">map</span>
                  Quick Link to Google Maps
                </a>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="text-sm font-bold text-background-dark dark:text-white">Support & Operating Hours</h3>
                <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
                  <li>
                    Email:{' '}
                    <a href="mailto:support@takcakap.com" className="font-semibold text-primary hover:underline">
                      support@takcakap.com
                    </a>
                  </li>
                  <li>
                    Phone:{' '}
                    <a href={`tel:${shopStatus?.storePhone || '+601166767365'}`} className="font-semibold text-primary hover:underline">
                      {shopStatus?.storePhone || '+601166767365'}
                    </a>
                  </li>
                  <li>Operating Hours: {shopStatus ? `${formatTimeLabel(shopStatus.openTime)} - ${formatTimeLabel(shopStatus.closeTime)}` : '9AM - 2PM'} (subject to availability)</li>
                </ul>
              </div>

              <div className="mt-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-background-dark dark:text-white">Payment</h3>
                <div className="mt-3 grid max-w-[330px] grid-cols-3 gap-1.5">
                  {paymentMethods.map((method) => (
                    <div
                      key={method.name}
                      className="flex h-10 items-center justify-center rounded-[3px] border border-zinc-200 bg-white px-1.5 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <img src={method.src} alt={method.name} className={`${method.className} w-auto max-w-full object-contain`} loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>

              <nav className="mt-5 hidden flex-wrap items-center text-sm font-semibold text-[#666] dark:text-zinc-400 lg:flex" aria-label="Legal links">
                <Link to="/about-us" className="whitespace-nowrap transition-colors hover:text-primary">About Us</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/contact-us" className="whitespace-nowrap transition-colors hover:text-primary">Contact Us</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/privacy-policy" className="whitespace-nowrap transition-colors hover:text-primary">Privacy Policy</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/terms-of-service" className="whitespace-nowrap transition-colors hover:text-primary">Terms & Conditions</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/refund-replacement-policy" className="whitespace-nowrap transition-colors hover:text-primary">Refund & Replacement Policy</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/delivery-policy" className="whitespace-nowrap transition-colors hover:text-primary">Delivery Policy</Link>
              </nav>
            </section>

            <section className="lg:pt-8">
              <h3 className="mb-3 text-sm font-bold text-background-dark dark:text-white">Store Location Map</h3>
              <div className="overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <iframe
                  title="D'warissan Ibunda Nasi Campur map"
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3972.598552294754!2d100.45450077584486!3d5.325140135926214!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x304ac814ae9d8007%3A0x4ba659682bb01a8d!2sD&#39;warissan%20Ibunda%20Nasi%20Campur!5e0!3m2!1sen!2smy!4v1771510818433!5m2!1sen!2smy"
                  width="100%"
                  height="180"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                ></iframe>
              </div>

              <nav className="mt-5 flex flex-wrap items-center text-sm font-semibold text-[#666] dark:text-zinc-400 lg:hidden" aria-label="Legal links">
                <Link to="/about-us" className="whitespace-nowrap transition-colors hover:text-primary">About Us</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/contact-us" className="whitespace-nowrap transition-colors hover:text-primary">Contact Us</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/privacy-policy" className="whitespace-nowrap transition-colors hover:text-primary">Privacy Policy</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/terms-of-service" className="whitespace-nowrap transition-colors hover:text-primary">Terms & Conditions</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/refund-replacement-policy" className="whitespace-nowrap transition-colors hover:text-primary">Refund & Replacement Policy</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/delivery-policy" className="whitespace-nowrap transition-colors hover:text-primary">Delivery Policy</Link>
              </nav>
            </section>
          </div>

          <div className="mt-8 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            © {currentYear} DE WARISAN IBUNDA ENTERPRISE (201003028216). All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
