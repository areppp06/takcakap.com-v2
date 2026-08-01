import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  isNativeApp,
  getFcmTokenSync,
  getNativeAlertStatus
} from '../utils/nativeBridge';
import { api } from '../services/api';

/**
 * Registers / unregisters the device FCM token with the backend when running
 * inside the TakCakap Admin Android shell. Invisible component.
 */
export const NativeAppManager: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const registeredTokenRef = useRef<string | null>(null);
  const lastAuthRef = useRef(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let registerInFlight = false;

    const waitForNative = async (seconds = 15): Promise<boolean> => {
      for (let i = 0; i < seconds; i++) {
        if (cancelled) return false;
        if (isNativeApp()) return true;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return isNativeApp();
    };

    const unregisterIfNeeded = async () => {
      if (!isNativeApp()) return;
      const token = registeredTokenRef.current || getFcmTokenSync();
      if (!token) return;
      try {
        await api.unregisterAdminFcmToken(token);
        console.log('[NativeAppManager] FCM token unregistered on logout');
      } catch (err) {
        console.error('[NativeAppManager] Unregister failed', err);
      } finally {
        registeredTokenRef.current = null;
      }
    };

    const registerToken = async (force = false) => {
      if (registerInFlight) return;
      registerInFlight = true;
      try {
        const nativeReady = await waitForNative(12);
        if (cancelled || !nativeReady) {
          if (!nativeReady) {
            console.log('[NativeAppManager] Not running inside native app. Skipping.');
          }
          return;
        }

        if (!isAuthenticated || user?.role !== 'admin') {
          return;
        }

        let token: string | null = null;
        for (let attempt = 1; attempt <= 30; attempt++) {
          if (cancelled) return;
          token = getFcmTokenSync();
          if (token) {
            console.log(`[NativeAppManager] Got FCM token on attempt ${attempt}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        if (!token) {
          console.error('[NativeAppManager] Could not retrieve FCM token after 30s');
          if (!cancelled) setBanner('Order alerts not armed: missing FCM token. Reopen the app.');
          return;
        }

        if (!force && registeredTokenRef.current === token) {
          return;
        }

        const deviceInfo = [
          'android',
          navigator.userAgent.includes('Android') ? 'webview' : 'native',
          (navigator as any).userAgentData?.platform || ''
        ].filter(Boolean).join(';').slice(0, 255);

        let lastError: unknown = null;
        for (let retry = 1; retry <= 5; retry++) {
          if (cancelled) return;
          try {
            await api.registerAdminFcmToken(token, deviceInfo);
            registeredTokenRef.current = token;
            console.log('[NativeAppManager] FCM token registered with backend');
            if (!cancelled) {
              const status = getNativeAlertStatus();
              if (status && !status.notificationsEnabled) {
                setBanner('Enable notifications for TakCakap Admin or closed-app alarms will fail.');
              } else if (status && !status.batteryUnrestricted) {
                setBanner('Disable battery optimization for TakCakap Admin for reliable closed-app alarms.');
              } else {
                setBanner(null);
              }
            }
            return;
          } catch (error) {
            lastError = error;
            console.error(`[NativeAppManager] Register failed attempt ${retry}/5`, error);
            await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * retry)));
          }
        }
        console.error('[NativeAppManager] Register gave up', lastError);
        if (!cancelled) setBanner('Order alerts not armed: server token registration failed.');
      } finally {
        registerInFlight = false;
      }
    };

    const wasAuthed = lastAuthRef.current;
    const isAuthedAdmin = Boolean(isAuthenticated && user?.role === 'admin');
    lastAuthRef.current = isAuthedAdmin;

    if (wasAuthed && !isAuthedAdmin) {
      void unregisterIfNeeded();
      setBanner(null);
    } else if (isAuthedAdmin) {
      void registerToken(false);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isAuthedAdmin && !cancelled) {
        void registerToken(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Slow periodic re-check (token rotation) — not every 10s spam
    const interval = window.setInterval(() => {
      if (!cancelled && isAuthedAdmin) {
        void registerToken(false);
      }
    }, 120000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated, user?.role]);

  if (!banner || !isNativeApp()) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[150] px-3 pt-2 pointer-events-none">
      <div className="mx-auto max-w-lg rounded-xl bg-amber-500 text-black text-xs font-semibold px-3 py-2 shadow-lg pointer-events-auto">
        {banner}
      </div>
    </div>
  );
};

export default NativeAppManager;
