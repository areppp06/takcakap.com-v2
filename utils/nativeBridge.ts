/**
 * Native App Bridge - Web Side
 *
 * Talks to window.TakCakapNative (Java JavascriptInterface) inside the APK.
 * Safe no-ops in a normal browser.
 */

export function isNativeApp(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.() ||
      !!(window as any).TakCakapNative;
  } catch {
    return false;
  }
}

function native(): any | null {
  try {
    return (window as any).TakCakapNative || null;
  } catch {
    return null;
  }
}

/** Stop the native looping order alarm (fixed notification id on Android). */
export function stopNativeAlarm() {
  const bridge = native();
  if (!bridge?.stopAlarm) return;
  try {
    bridge.stopAlarm();
  } catch (err) {
    console.error('[nativeBridge] stopAlarm failed', err);
  }
}

/** Alias used when accepting an order. */
export function acceptOrderNative() {
  stopNativeAlarm();
}

/** Sync FCM token from native SharedPreferences. */
export function getFcmTokenSync(): string | null {
  const bridge = native();
  if (!bridge?.getFcmToken) return null;
  try {
    const token = bridge.getFcmToken();
    if (typeof token === 'string' && token.trim()) return token.trim();
    return null;
  } catch {
    return null;
  }
}

/** Local native test alarm (does not hit the server). */
export function testNativeAlarm() {
  const bridge = native();
  if (bridge?.testAlarm) {
    try {
      bridge.testAlarm();
      return;
    } catch (err) {
      console.error('[nativeBridge] testAlarm failed', err);
    }
  }
}

export type NativeAlertStatus = {
  hasToken: boolean;
  notificationsEnabled: boolean;
  batteryUnrestricted: boolean;
  alarmActive: boolean;
  armed: boolean;
  tokenPreview: string;
};

export function getNativeAlertStatus(): NativeAlertStatus | null {
  const bridge = native();
  if (!bridge?.getAlertStatus) return null;
  try {
    const raw = bridge.getAlertStatus();
    if (!raw || typeof raw !== 'string') return null;
    return JSON.parse(raw) as NativeAlertStatus;
  } catch {
    return null;
  }
}

export function isNativeAlarmActive(): boolean {
  const bridge = native();
  if (!bridge?.isAlarmActive) return false;
  try {
    return Boolean(bridge.isAlarmActive());
  } catch {
    return false;
  }
}
