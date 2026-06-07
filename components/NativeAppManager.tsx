import React, { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isNativeApp, getFcmTokenSync } from '../utils/nativeBridge';
import { api } from '../services/api';

/**
 * Handles communication with the native Android app shell,
 * including registering the FCM push token with our backend.
 * 
 * This component is rendered inside App.tsx and runs invisibly.
 * It will:
 * 1. Wait for the user to be authenticated as an admin.
 * 2. Poll for the native FCM token (may take a few seconds on first boot).
 * 3. Register that token with our backend database.
 * 4. Re-register on every app resume (in case the token rotated).
 */
export const NativeAppManager: React.FC = () => {
    const { isAuthenticated, user } = useAuth();
    const registeredTokenRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const checkAndRegister = async () => {
            // Wait for native app bridge detection to be ready (up to 10 seconds)
            let nativeReady = false;
            for (let check = 1; check <= 10; check++) {
                if (cancelled) return;
                if (isNativeApp()) {
                    nativeReady = true;
                    break;
                }
                console.log(`[NativeAppManager] Checking for native app interface (attempt ${check}/10)...`);
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!nativeReady) {
                console.log('[NativeAppManager] Not running inside native app. Skipping.');
                return;
            }

            if (!isAuthenticated) {
                console.log('[NativeAppManager] User not authenticated yet. Waiting...');
                return;
            }

            if (user?.role !== 'admin') {
                console.log('[NativeAppManager] User role is not admin. Skipping FCM registration.');
                return;
            }

            console.log('[NativeAppManager] Admin user detected inside native app. Starting FCM token registration...');

            // Poll for the FCM token — it's async on the native side
            let token: string | null = null;
            for (let attempt = 1; attempt <= 30; attempt++) {
                if (cancelled) return;
                
                token = getFcmTokenSync();
                
                if (token && token.length > 0) {
                    console.log(`[NativeAppManager] Got FCM token on attempt ${attempt}: ${token.substring(0, 20)}...`);
                    break;
                }
                
                console.log(`[NativeAppManager] FCM token not ready yet (attempt ${attempt}/30). Retrying in 1s...`);
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!token || token.length === 0) {
                console.error('[NativeAppManager] ❌ FAILED: Could not retrieve FCM token after 30 seconds.');
                return;
            }

            // Don't re-register the exact same token
            if (registeredTokenRef.current === token) {
                console.log('[NativeAppManager] Token already registered. Skipping.');
                return;
            }

            // Register with backend
            for (let retry = 1; retry <= 3; retry++) {
                if (cancelled) return;
                
                try {
                    console.log(`[NativeAppManager] Registering token with backend (attempt ${retry}/3)...`);
                    await api.registerAdminFcmToken(token);
                    registeredTokenRef.current = token;
                    console.log('[NativeAppManager] ✅ FCM token registered successfully with backend!');
                    return;
                } catch (error) {
                    console.error(`[NativeAppManager] ❌ Backend registration failed (attempt ${retry}/3):`, error);
                    if (retry < 3) {
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }

            console.error('[NativeAppManager] ❌ FAILED: Could not register FCM token after 3 retries.');
        };

        checkAndRegister();

        // Also re-register when the app comes back to the foreground
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !cancelled) {
                console.log('[NativeAppManager] App resumed. Re-checking FCM token...');
                checkAndRegister();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Check for token updates or new token generations every 10 seconds
        const tokenInterval = setInterval(() => {
            if (!cancelled) {
                console.log('[NativeAppManager] Periodic FCM token check...');
                checkAndRegister();
            }
        }, 10000);

        return () => {
            cancelled = true;
            clearInterval(tokenInterval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isAuthenticated, user?.role]);

    return null; // Invisible component
};
