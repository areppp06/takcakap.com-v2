import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const PWAInstallBanner: React.FC = () => {
  const [showBanner, setShowBanner] = useState(false);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const location = useLocation();

  // Hide on admin routes
  const isAdminRoute = location.pathname.startsWith('/admin');

  useEffect(() => {
    // 1. Check if running in standalone mode (already installed/launched from home screen)
    const isStandalone = 
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone || isAdminRoute) {
      setShowBanner(false);
      return;
    }

    // 2. Check dismissal cooldown (14 days)
    const dismissedTime = localStorage.getItem('pwa_dismissed_time');
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    if (dismissedTime && (Date.now() - Number(dismissedTime) < fourteenDaysMs)) {
      setShowBanner(false);
      return;
    }

    // 3. Detect Platform
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /ipad|iphone|ipod/.test(userAgent) && !(window as any).MSStream;
    const isAndroid = /android/.test(userAgent);

    // 4. Register event listener for Android / Chrome native install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform('android');
      setShowBanner(true);
      // Trigger animations slightly after mount
      setTimeout(() => setAnimateIn(true), 100);
    };

    if (!isIOS) {
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }

    // 5. Handle iOS prompt (Safari doesn't support programmatic beforeinstallprompt)
    if (isIOS) {
      setPlatform('ios');
      setShowBanner(true);
      setTimeout(() => setAnimateIn(true), 100);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [isAdminRoute]);

  const handleInstallAndroid = async () => {
    if (!deferredPrompt) return;
    
    // Hide the banner initially
    setAnimateIn(false);
    setTimeout(() => setShowBanner(false), 500);

    // Trigger native prompt
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      localStorage.setItem('pwa_installed', 'true');
    } else {
      // If user dismissed the browser prompt, set cooldown
      localStorage.setItem('pwa_dismissed_time', Date.now().toString());
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setAnimateIn(false);
    // Wait for slide-down animation to complete before unmounting
    setTimeout(() => {
      setShowBanner(false);
      localStorage.setItem('pwa_dismissed_time', Date.now().toString());
    }, 500);
  };

  // Do not render anything if banner should be hidden or it is an admin route
  if (!showBanner || isAdminRoute) return null;

  return (
    <div
      className={`fixed bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-[380px] z-[9999] transition-all duration-500 ease-out transform ${
        animateIn ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
      }`}
    >
      <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200/50 dark:border-zinc-800/50 shadow-2xl rounded-2xl p-5 relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 bg-primary/10 rounded-full blur-xl pointer-events-none" />

        <div className="flex items-start gap-4">
          {/* Logo container */}
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/20 shadow-inner">
            <span className="material-symbols-outlined text-primary text-2xl font-bold">
              restaurant
            </span>
          </div>

          <div className="flex-1">
            <h3 className="text-zinc-950 dark:text-white font-extrabold text-base leading-snug">
              Install TakCakap App
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 text-xs mt-1.5 leading-relaxed">
              Add TakCakap to your home screen for quick one-tap ordering and a premium app experience.
            </p>

            {platform === 'ios' ? (
              // iOS Safari instructions
              <div className="mt-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl p-3 border border-zinc-100 dark:border-zinc-800/60 text-[11px] text-zinc-600 dark:text-zinc-400 space-y-2">
                <p className="font-semibold text-zinc-850 dark:text-zinc-300">
                  How to install on iOS Safari:
                </p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    Tap the{' '}
                    <span className="inline-flex items-center align-middle font-semibold text-primary">
                      Share
                      <span className="material-symbols-outlined text-sm ml-0.5">share</span>
                    </span>{' '}
                    button in Safari.
                  </li>
                  <li>
                    Scroll down and tap{' '}
                    <span className="inline-flex items-center align-middle font-semibold text-primary">
                      Add to Home Screen
                      <span className="material-symbols-outlined text-sm ml-0.5">add_box</span>
                    </span>.
                  </li>
                </ol>
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-3">
              {platform === 'android' ? (
                <button
                  onClick={handleInstallAndroid}
                  className="flex-1 bg-primary hover:bg-[#cc10c3] text-background-dark font-extrabold text-xs py-2.5 px-4 rounded-xl shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  Install Now
                </button>
              ) : (
                <button
                  onClick={handleDismiss}
                  className="flex-1 bg-primary hover:bg-[#cc10c3] text-background-dark font-extrabold text-xs py-2.5 px-4 rounded-xl shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  Got It
                </button>
              )}
              <button
                onClick={handleDismiss}
                className="px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-semibold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors focus:outline-none"
              >
                Not Now
              </button>
            </div>
          </div>
        </div>

        {/* Small Close Button on Top Right */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-zinc-400 dark:text-zinc-500 hover:text-zinc-650 dark:hover:text-zinc-305 transition-colors focus:outline-none"
          aria-label="Dismiss prompt"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>
    </div>
  );
};

export default PWAInstallBanner;
