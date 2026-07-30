import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../services/mockData';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import BrandLogo from '../components/BrandLogo';
import { api } from '../services/api';
import { ShopStatus } from '../types';

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

const AboutUs: React.FC = () => {
  const { cartCount } = useCart();
  const { user, isAuthenticated } = useAuth();
  const profileAvatar = user?.avatar || currentUser.avatar;
  const currentYear = new Date().getFullYear();

  const [shopStatus, setShopStatus] = useState<ShopStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getShopStatus()
      .then((status) => {
        if (!cancelled) setShopStatus(status);
      })
      .catch((err) => console.error('Failed to load shop status in AboutUs', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const paymentMethods = [
    { name: 'TNG eWallet', src: 'https://www.touchngo.com.my/assets/logo-tngewallet.svg', className: 'h-6' },
    { name: 'Visa', src: 'https://down-my.img.susercontent.com/file/735e9b602704f9fcecc0fc589358d5df', className: 'h-6' },
    { name: 'Mastercard', src: 'https://down-my.img.susercontent.com/file/8612df33671e5fcf4e3896dddc09126f', className: 'h-6' },
    { name: 'FPX', src: 'https://down-my.img.susercontent.com/file/be96ecd1fe21e89d006f285bae7db4ee', className: 'h-6' },
    { name: 'Additional Payment', src: 'https://down-my.img.susercontent.com/file/2d504b9eaad31ffb9d9a5070a7f3207b', className: 'h-6' }
  ];

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100">
      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4">
        <header className="bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border border-white/20 dark:border-white/5 shadow-lg rounded-full flex items-center justify-between w-full max-w-4xl min-h-[72px] sm:min-h-[84px] px-4 sm:px-6 py-2 sm:py-3">
          <Link to="/" aria-label="Go to home" className="flex items-center min-w-[88px] sm:min-w-[122px]">
            <BrandLogo
              alt="Brand logo"
              className="h-[35px] w-[88px] sm:h-[48px] sm:w-[122px] object-contain object-left"
              fallbackIcon="restaurant"
              fallbackIconClassName="material-symbols-outlined block text-4xl text-primary font-bold"
            />
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/checkout" className="relative flex items-center justify-center size-10 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 transition-colors">
              <span className="material-symbols-outlined text-2xl">shopping_cart</span>
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-background-dark border-2 border-white">{cartCount}</span>
              )}
            </Link>
            <Link to={isAuthenticated ? '/dashboard' : '/login'} className="flex items-center justify-center size-10 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 transition-colors overflow-hidden">
              {isAuthenticated ? (
                <img className="w-full h-full object-cover" src={profileAvatar} alt="Profile" />
              ) : (
                <span className="material-symbols-outlined text-2xl">person</span>
              )}
            </Link>
          </div>
        </header>
      </div>

      <main className="pt-32 sm:pt-36">
        <section className="relative overflow-hidden border-b border-primary/10 bg-gradient-to-br from-white via-[#fcfbff] to-[#f7f2fb] dark:from-background-dark dark:via-background-dark dark:to-[#2b1430]">
          <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" aria-hidden="true"></div>
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-primary/10 blur-3xl" aria-hidden="true"></div>

          <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-14 lg:px-8 lg:py-20">
            <div>
              <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.16em] text-primary">
                Our Journey
              </span>
              <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-background-dark dark:text-white sm:text-5xl lg:text-6xl">
                Connecting with us is more easy then before...
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
                TakCakap.com is an online ordering platform by DE WARISAN IBUNDA ENTERPRISE, a food and beverage business established in 2008. Built on years of industry experience, the platform offers customers a convenient digital way to order our products for pickup or delivery.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/"
                  className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-background-dark shadow-sm transition-colors hover:bg-[#cc10c3]"
                >
                  Order Now
                </Link>
                <Link
                  to="/contact-us"
                  className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-background-dark transition-colors hover:border-primary/60 hover:text-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  Contact Support
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-2 rounded-3xl bg-primary/20 blur-2xl" aria-hidden="true"></div>
              <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-white shadow-2xl dark:bg-zinc-900">
                <iframe
                  title="Store location preview map"
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3972.598552294754!2d100.45450077584486!3d5.325140135926214!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x304ac814ae9d8007%3A0x4ba659682bb01a8d!2sD&#39;warissan%20Ibunda%20Nasi%20Campur!5e0!3m2!1sen!2smy!4v1771510818433!5m2!1sen!2smy"
                  className="h-[290px] w-full sm:h-[360px]"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                ></iframe>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="rounded-2xl border border-primary/15 bg-white p-6 shadow-sm dark:border-primary/20 dark:bg-zinc-900/40 sm:p-8">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-2xl">restaurant</span>
              </div>
              <h2 className="text-2xl font-extrabold text-background-dark dark:text-white">Operational Details</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
                Our platform is designed to simplify ordering, payment processing, and fulfillment coordination. We primarily prepare our own food products, while certain items may be supplied by selected third-party vendors.
              </p>
            </article>

            <article className="rounded-2xl border border-primary/15 bg-white p-6 shadow-sm dark:border-primary/20 dark:bg-zinc-900/40 sm:p-8">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-2xl">badge</span>
              </div>
              <h2 className="text-2xl font-extrabold text-background-dark dark:text-white">Business Registration</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
                <strong>Entity:</strong> DE WARISAN IBUNDA ENTERPRISE<br />
                <strong>Registration No:</strong> 201003028216<br />
                <strong>Registered Country:</strong> Malaysia
              </p>
            </article>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-2xl">verified</span>
              </div>
              <h3 className="text-2xl font-extrabold text-background-dark dark:text-white">Our Commitment</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
                We are committed to providing reliable service, accurate order handling, and dedicated customer support for every transaction.
              </p>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-2xl">payments</span>
              </div>
              <h3 className="text-2xl font-extrabold text-background-dark dark:text-white">Payments &amp; Delivery</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
                Orders are processed securely via third-party payment gateways. Delivery services are handled by independent logistics partners.
              </p>
            </article>
          </div>
        </section>

        <section className="mx-auto max-w-7xl border-t border-zinc-200 px-4 py-12 dark:border-zinc-800 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="rounded-2xl border border-primary/15 bg-white p-6 shadow-sm dark:border-primary/20 dark:bg-zinc-900/40 sm:p-8">
              <h4 className="text-2xl font-extrabold text-background-dark dark:text-white">Business Location</h4>
              <div className="mt-4 flex items-start gap-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
                <span className="material-symbols-outlined mt-0.5 text-primary">location_on</span>
                <p>
                  {shopStatus?.storeAddress || 'Medan Seleraneka Perda Gerai No.1, 2, Taman IKS Bukit Minyak, Lorong IKS Bukit Minyak 1, Seberang Perai Tengah, Pulau Pinang, 14000, Malaysia.'}
                </p>
              </div>
            </article>

            <article className="rounded-2xl border border-primary/15 bg-white p-6 shadow-sm dark:border-primary/20 dark:bg-zinc-900/40 sm:p-8">
              <h4 className="text-2xl font-extrabold text-background-dark dark:text-white">Customer Support</h4>
              <ul className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-300 sm:text-base">
                <li className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary">mail</span>
                  <a href="mailto:support@takcakap.com" className="font-semibold text-primary hover:underline">
                    support@takcakap.com
                  </a>
                </li>
                <li className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary">call</span>
                  <a href={`tel:${shopStatus?.storePhone || '+601166767365'}`} className="font-semibold text-primary hover:underline">
                    {shopStatus?.storePhone || '+601166767365'}
                  </a>
                </li>
                <li className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary">schedule</span>
                  <span>{shopStatus ? `${formatTimeLabel(shopStatus.openTime)} - ${formatTimeLabel(shopStatus.closeTime)}` : '9:00 AM - 2:00 PM'} (Subject to availability)</span>
                </li>
              </ul>
            </article>
          </div>
        </section>
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
                <h3 className="text-sm font-bold text-background-dark dark:text-white">Support &amp; Operating Hours</h3>
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
                <Link to="/terms-of-service" className="whitespace-nowrap transition-colors hover:text-primary">Terms &amp; Conditions</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/refund-replacement-policy" className="whitespace-nowrap transition-colors hover:text-primary">Refund &amp; Replacement Policy</Link>
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
                <Link to="/terms-of-service" className="whitespace-nowrap transition-colors hover:text-primary">Terms &amp; Conditions</Link>
                <span className="mx-2 text-zinc-400 dark:text-zinc-600" aria-hidden="true">|</span>
                <Link to="/refund-replacement-policy" className="whitespace-nowrap transition-colors hover:text-primary">Refund &amp; Replacement Policy</Link>
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

export default AboutUs;
