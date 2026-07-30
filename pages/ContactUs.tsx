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

type FormState = {
  fullName: string;
  email: string;
  subject: string;
  message: string;
};

const ContactUs: React.FC = () => {
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
      .catch((err) => console.error('Failed to load shop status in ContactUs', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const [form, setForm] = useState<FormState>({
    fullName: '',
    email: '',
    subject: 'General Inquiry',
    message: ''
  });
  const [formNotice, setFormNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!formNotice) return;
    const timeoutId = window.setTimeout(() => setFormNotice(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [formNotice]);

  const paymentMethods = [
    { name: 'TNG eWallet', src: 'https://www.touchngo.com.my/assets/logo-tngewallet.svg', className: 'h-6' },
    { name: 'Visa', src: 'https://down-my.img.susercontent.com/file/735e9b602704f9fcecc0fc589358d5df', className: 'h-6' },
    { name: 'Mastercard', src: 'https://down-my.img.susercontent.com/file/8612df33671e5fcf4e3896dddc09126f', className: 'h-6' },
    { name: 'FPX', src: 'https://down-my.img.susercontent.com/file/be96ecd1fe21e89d006f285bae7db4ee', className: 'h-6' },
    { name: 'Additional Payment', src: 'https://down-my.img.susercontent.com/file/2d504b9eaad31ffb9d9a5070a7f3207b', className: 'h-6' }
  ];

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const fullName = form.fullName.trim();
    const email = form.email.trim();
    const message = form.message.trim();
    if (!fullName || !email || !message) {
      setFormNotice({
        type: 'error',
        message: 'Please fill in Full Name, Email Address, and Message.'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const recipient = 'support@takcakap.com';
      const subjectRaw = `[Contact Form] ${form.subject}`;
      const bodyRaw = `Name: ${fullName}\nEmail: ${email}\nSubject: ${form.subject}\n\nMessage:\n${message}`;
      const subject = encodeURIComponent(subjectRaw);
      const body = encodeURIComponent(bodyRaw);
      const isDesktopBrowser =
        window.matchMedia('(min-width: 1024px)').matches &&
        !/Mobi|Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent || '');

      if (isDesktopBrowser) {
        const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${subject}&body=${body}`;
        const opened = window.open(gmailComposeUrl, '_blank', 'noopener,noreferrer');
        if (!opened) {
          window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
        }
      } else {
        window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
      }

      setFormNotice({
        type: 'success',
        message: isDesktopBrowser
          ? 'Gmail compose opened. Please send it to complete your inquiry.'
          : 'Email draft opened. Please send it to complete your inquiry.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-32 sm:px-6 lg:px-8 lg:pt-36">
        <section className="max-w-3xl">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            Let&apos;s start a <span className="text-primary">conversation</span>.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600 dark:text-slate-400 sm:text-lg">
            Have questions about your order, delivery, payment, or account? Our support team is ready to assist you.
          </p>
        </section>

        <section className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <article className="rounded-2xl border border-primary/10 bg-white p-5 shadow-sm dark:bg-zinc-900/40">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <span className="material-symbols-outlined">location_on</span>
                </div>
                <h2 className="text-lg font-bold">Our Store</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {shopStatus?.storeAddress || 'Medan Seleraneka Perda Gerai No.1, 2, Taman IKS Bukit Minyak, Lorong IKS Bukit Minyak 1 Seberang Perai Tengah, Pulau Pinang, 14000'}
                </p>
              </article>

              <article className="rounded-2xl border border-primary/10 bg-white p-5 shadow-sm dark:bg-zinc-900/40">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <span className="material-symbols-outlined">call</span>
                </div>
                <h2 className="text-lg font-bold">Phone</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  <a href={`tel:${shopStatus?.storePhone || '+601166767365'}`} className="font-semibold text-primary hover:underline">
                    {shopStatus?.storePhone || '+601166767365'}
                  </a>
                  <br />
                  {shopStatus ? `${formatTimeLabel(shopStatus.openTime)} - ${formatTimeLabel(shopStatus.closeTime)}` : '9AM - 2PM'} (subject to availability)
                </p>
              </article>

              <article className="rounded-2xl border border-primary/10 bg-white p-5 shadow-sm dark:bg-zinc-900/40">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <span className="material-symbols-outlined">mail</span>
                </div>
                <h2 className="text-lg font-bold">Email</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  <a href="mailto:support@takcakap.com" className="font-semibold text-primary hover:underline">
                    support@takcakap.com
                  </a>
                </p>
              </article>

              <article className="rounded-2xl border border-primary/10 bg-white p-5 shadow-sm dark:bg-zinc-900/40">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <span className="material-symbols-outlined">chat</span>
                </div>
                <h2 className="text-lg font-bold">WhatsApp</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  <a
                    href={`https://wa.me/${(shopStatus?.storePhone || '+601166767365').replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-primary hover:underline"
                  >
                    Chat on WhatsApp
                  </a>
                </p>
              </article>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <iframe
                title="D'warissan Ibunda Nasi Campur map"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3972.598552294754!2d100.45450077584486!3d5.325140135926214!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x304ac814ae9d8007%3A0x4ba659682bb01a8d!2sD&#39;warissan%20Ibunda%20Nasi%20Campur!5e0!3m2!1sen!2smy!4v1771510818433!5m2!1sen!2smy"
                width="100%"
                height="300"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              ></iframe>
            </div>
          </div>

          <div className="rounded-2xl border border-primary/15 bg-white p-6 shadow-xl dark:bg-zinc-900/40 sm:p-8 lg:p-10">
            <h2 className="text-2xl font-extrabold tracking-tight">Contact Form</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Send us your message and we will get back to you as soon as possible.
            </p>

            {formNotice && (
              <div
                className={`mt-5 rounded-xl border px-4 py-3 text-sm font-semibold ${
                  formNotice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
                role="status"
                aria-live="polite"
              >
                {formNotice.message}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="ml-1 block text-sm font-semibold">Full Name</span>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(event) => handleChange('fullName', event.target.value)}
                    placeholder="Your full name"
                    className="w-full rounded-xl border border-slate-200 bg-background-light px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary dark:border-primary/20 dark:bg-background-dark"
                  />
                </label>
                <label className="space-y-2">
                  <span className="ml-1 block text-sm font-semibold">Email Address</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => handleChange('email', event.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-slate-200 bg-background-light px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary dark:border-primary/20 dark:bg-background-dark"
                  />
                </label>
              </div>

              <label className="space-y-2">
                <span className="ml-1 block text-sm font-semibold">Subject</span>
                <select
                  value={form.subject}
                  onChange={(event) => handleChange('subject', event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-background-light px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary dark:border-primary/20 dark:bg-background-dark"
                >
                  <option>General Inquiry</option>
                  <option>Order Support</option>
                  <option>Delivery Issue</option>
                  <option>Payment Support</option>
                  <option>Technical Support</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="ml-1 block text-sm font-semibold">Message</span>
                <textarea
                  value={form.message}
                  onChange={(event) => handleChange('message', event.target.value)}
                  placeholder="Tell us how we can help..."
                  rows={6}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-background-light px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary dark:border-primary/20 dark:bg-background-dark"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_0_24px_rgba(230,25,219,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{isSubmitting ? 'Opening...' : 'Send Message'}</span>
                <span className="material-symbols-outlined text-lg transition-transform group-hover:translate-x-0.5">send</span>
              </button>
            </form>
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

export default ContactUs;
