import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import {
  getNativeAlertStatus,
  isNativeApp,
  stopNativeAlarm,
  testNativeAlarm,
  type NativeAlertStatus
} from '../utils/nativeBridge';

/**
 * Kitchen alert arming status + test buttons (native APK and browser admin).
 */
const AdminKitchenAlerts: React.FC = () => {
  const native = isNativeApp();
  const [nativeStatus, setNativeStatus] = useState<NativeAlertStatus | null>(null);
  const [serverStatus, setServerStatus] = useState<{
    firebaseReady: boolean;
    tokenCount: number;
    freshTokenCount?: number;
    maxAgeDays?: number;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (native) {
      setNativeStatus(getNativeAlertStatus());
    }
    try {
      const status = await api.getAdminFcmStatus();
      setServerStatus({
        firebaseReady: status.firebaseReady,
        tokenCount: status.tokenCount,
        freshTokenCount: (status as any).freshTokenCount,
        maxAgeDays: (status as any).maxAgeDays
      });
    } catch (err: any) {
      setServerStatus(null);
      console.error('FCM status failed', err);
    }
  }, [native]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const runServerTest = async () => {
    setBusy(true);
    setMessage('');
    try {
      // Close app first for true closed-app test — this still works when open.
      const result = await api.testAdminFcm();
      setMessage(
        `Server FCM test sent. devices=${result.tokenCount ?? 0} ok=${result.successCount ?? 0} fail=${result.failureCount ?? 0}. Close the app and run again to verify killed-state delivery.`
      );
      await refresh();
    } catch (err: any) {
      setMessage(err?.message || 'Server FCM test failed');
    } finally {
      setBusy(false);
    }
  };

  const runLocalTest = () => {
    testNativeAlarm();
    setMessage('Local native alarm started. Tap Stop alarm or open/resume the app.');
    setNativeStatus(getNativeAlertStatus());
  };

  const stop = () => {
    stopNativeAlarm();
    setMessage('Native alarm stopped.');
    setNativeStatus(getNativeAlertStatus());
  };

  const armed =
    (serverStatus?.firebaseReady && (serverStatus?.freshTokenCount ?? serverStatus?.tokenCount ?? 0) > 0) &&
    (!native || nativeStatus?.armed !== false);

  return (
    <section className="mb-10 rounded-2xl border border-primary/15 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">notifications_active</span>
            Kitchen order alerts
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Closed-app ringing uses FCM → native alarm. SSE only updates the live dashboard.
          </p>
        </div>
        <span
          className={`inline-flex items-center self-start px-2.5 py-1 rounded-full text-xs font-bold ${
            armed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
          }`}
        >
          {armed ? 'ARMED' : 'NOT ARMED'}
        </span>
      </div>

      <ul className="text-sm space-y-1.5 mb-4 text-slate-600 dark:text-slate-300">
        <li>Firebase server: {serverStatus ? (serverStatus.firebaseReady ? 'ready' : 'NOT configured') : '…'}</li>
        <li>
          Registered devices: {serverStatus ? serverStatus.tokenCount : '…'}
          {serverStatus?.freshTokenCount != null
            ? ` (${serverStatus.freshTokenCount} fresh / ${serverStatus.maxAgeDays ?? 14}d)`
            : ''}
        </li>
        {native && (
          <>
            <li>This device FCM token: {nativeStatus?.hasToken ? nativeStatus.tokenPreview || 'yes' : 'missing'}</li>
            <li>Notifications permission: {nativeStatus?.notificationsEnabled ? 'allowed' : 'DENIED'}</li>
            <li>Battery unrestricted: {nativeStatus?.batteryUnrestricted ? 'yes' : 'no (recommended)'}</li>
            <li>Alarm ringing now: {nativeStatus?.alarmActive ? 'yes' : 'no'}</li>
          </>
        )}
        {!native && (
          <li className="text-amber-700 dark:text-amber-300">
            Browser admin: open-tab alerts only. Install the Android admin APK for closed-app alarms.
          </li>
        )}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void runServerTest()}
          className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send test FCM'}
        </button>
        {native && (
          <>
            <button
              type="button"
              onClick={runLocalTest}
              className="px-3 py-2 rounded-lg border border-primary/30 text-sm font-bold hover:bg-primary/5"
            >
              Local native test
            </button>
            <button
              type="button"
              onClick={stop}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Stop alarm
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          Refresh status
        </button>
      </div>

      {message && (
        <p className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
          {message}
        </p>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        Setup: allow notifications · disable battery optimization for this app · do not use Android “Force stop” ·
        keep mobile data/Wi‑Fi on. After reboot, open the app once if alerts stop.
      </p>
    </section>
  );
};

export default AdminKitchenAlerts;
