/**
 * Native App Bridge - Web Side
 * 
 * Provides helper functions for the admin web app to communicate
 * with the native Android wrapper (Capacitor) when running inside it.
 * 
 * Safe to import everywhere - all functions are no-ops when running in a browser.
 */

// ─── Detection ───────────────────────────────────────────────────────────────

/** Returns true when the web app is running inside the Capacitor native shell. */
export function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.() ||
    !!(window as any).TakCakapNative;
}

// ─── Outgoing Messages (Web → Native) ────────────────────────────────────────

function sendToNative(action: string, payload: Record<string, unknown> = {}) {
  if (!isNativeApp()) return;
  try {
    window.postMessage(
      JSON.stringify({ source: 'takcakap-admin', action, ...payload }),
      '*'
    );
  } catch {
    // Silently ignore - we're probably not in the native shell
  }
}

/** Tell the native app to stop the repeating alarm. */
export function stopNativeAlarm() {
  if (isNativeApp() && (window as any).TakCakapNative) {
    (window as any).TakCakapNative.stopAlarm();
  }
}

/** Tell the native app the admin accepted an order (stops alarm too). */
export function acceptOrderNative() {
  stopNativeAlarm();
}

/** Request the FCM token synchronously from the native app. */
export function getFcmTokenSync(): string | null {
  if (isNativeApp() && (window as any).TakCakapNative) {
    return (window as any).TakCakapNative.getFcmToken();
  }
  return null;
}

/** Fire a test alarm on the native side. */
export function testNativeAlarm() {
  sendToNative('test-alarm');
}

// ─── Incoming Messages (Native → Web) ────────────────────────────────────────

export type NativeMessageHandler = (action: string, payload: any) => void;

let messageListener: ((e: MessageEvent) => void) | null = null;

/**
 * Register a listener for messages from the native app.
 * Returns an unsubscribe function.
 */
export function onNativeMessage(handler: NativeMessageHandler): () => void {
  // Remove any previous listener
  if (messageListener) {
    window.removeEventListener('message', messageListener);
  }

  messageListener = (event: MessageEvent) => {
    try {
      const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (msg?.source !== 'takcakap-native') return;
      handler(msg.action, msg.payload);
    } catch {
      // Not a JSON message from native, ignore
    }
  };

  window.addEventListener('message', messageListener);

  return () => {
    if (messageListener) {
      window.removeEventListener('message', messageListener);
      messageListener = null;
    }
  };
}
