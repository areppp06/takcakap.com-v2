import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  isNativeApp,
  getFcmTokenSync,
  getNativeAlertStatus
} from '../utils/nativeBridge';
import { api } from '../services/api';

/** Minimum gap between successful server POSTs (avoid spam). */
const MIN_POST_GAP_MS = 60 * 1000;
/** Force a server touch at least this often while logged in (bumps updated_at). */
const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How often we wake up to check if heartbeat is due / token rotated. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

type RegisterReason = 'login' | 'resume' | 'heartbeat' | 'online' | 'token_change';

/**
 * Keeps this device's FCM token alive on the server while the admin APK session
 * is active. Heartbeat re-POSTs the same token so 14d freshness never expires
 * on a live kitchen phone — including after long offline periods (on next open/online).
 */
export const NativeAppManager: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const registeredTokenRef = useRef<string | null>(null);
  const lastPostAtRef = useRef(0);
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
        lastPostAtRef.current = 0;
      }
    };

    const registerToken = async (reason: RegisterReason) => {
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

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          console.log(`[NativeAppManager] Offline — defer register (${reason})`);
          if (!cancelled) {
            setBanner('Order alerts paused: phone is offline. Will re-arm when online.');
          }
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

        const now = Date.now();
        const sameToken = registeredTokenRef.current === token;
        const msSincePost = now - lastPostAtRef.current;
        const heartbeatDue = msSincePost >= HEARTBEAT_INTERVAL_MS || lastPostAtRef.current === 0;
        const tooSoon = lastPostAtRef.current > 0 && msSincePost < MIN_POST_GAP_MS;

        // Always POST on login / coming online / token change.
        // Resume + heartbeat: POST if never posted, token changed, or heartbeat due.
        let shouldPost = false;
        if (!sameToken) {
          shouldPost = true;
          reason = registeredTokenRef.current ? 'token_change' : reason;
        } else if (reason === 'login' || reason === 'online') {
          shouldPost = !tooSoon || lastPostAtRef.current === 0;
        } else if (reason === 'resume' || reason === 'heartbeat') {
          shouldPost = heartbeatDue && !tooSoon;
        }

        // Resume after long offline: lastPost is old → heartbeatDue true → post
        if (reason === 'resume' && heartbeatDue) {
          shouldPost = true;
        }

        if (!shouldPost) {
          console.log(
            `[NativeAppManager] Skip POST (${reason}) sameToken=${sameToken} sincePostMs=${msSincePost}`
          );
          return;
        }

        const deviceInfo = [
          'android',
          'heartbeat',
          navigator.userAgent.includes('Android') ? 'webview' : 'native'
        ].join(';').slice(0, 255);

        let lastError: unknown = null;
        for (let retry = 1; retry <= 5; retry++) {
          if (cancelled) return;
          try {
            await api.registerAdminFcmToken(token, deviceInfo);
            registeredTokenRef.current = token;
            lastPostAtRef.current = Date.now();
            console.log(`[NativeAppManager] FCM token registered (${reason})`);
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
      void registerToken('login');
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isAuthedAdmin && !cancelled) {
        void registerToken('resume');
      }
    };

    const onOnline = () => {
      if (isAuthedAdmin && !cancelled) {
        console.log('[NativeAppManager] Network online — re-arm FCM token');
        void registerToken('online');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    const interval = window.setInterval(() => {
      if (!cancelled && isAuthedAdmin) {
        void registerToken('heartbeat');
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
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
