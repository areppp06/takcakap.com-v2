import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { isNativeApp, stopNativeAlarm } from '../utils/nativeBridge';

const AdminOrderAlert: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const soundUrl = (import.meta as any).env.VITE_ADMIN_ORDER_ALERT_SOUND_URL || '/admin-order-alert.mp3';
  const nativeShell = isNativeApp();

  const stopAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  };

  const startAudio = async () => {
    // Inside the APK, native FCM alarm is the primary ringer.
    // Browser-only admin still uses looping HTML audio.
    if (nativeShell) return;

    if (!audioRef.current) {
      const audio = new Audio(soundUrl);
      audio.preload = 'auto';
      audio.loop = true;
      audioRef.current = audio;
    }
    audioRef.current.volume = 1;
    try {
      await audioRef.current.play();
    } catch (error) {
      console.error('Admin alert sound playback blocked:', error);
    }
  };

  const dismissAlert = () => {
    stopNativeAlarm();
    stopAudio();
    setIsOpen(false);
    navigate('/admin/orders');
  };

  useEffect(() => {
    if (isOpen) {
      startAudio();
      return;
    }
    stopAudio();
  }, [isOpen, soundUrl, nativeShell]);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'admin' || !user?.id) {
      setIsOpen(false);
      stopAudio();
      stopNativeAlarm();
      return;
    }

    let disposed = false;
    let streamAbortController: AbortController | null = null;

    const closeCurrentSource = () => {
      if (streamAbortController) {
        streamAbortController.abort();
        streamAbortController = null;
      }
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = (delayMs = 5000) => {
      if (disposed) return;
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        void connect();
      }, delayMs);
    };

    const connect = async () => {
      if (disposed) return;
      let streamToken = '';
      try {
        const streamSession = await api.getAdminOrdersStreamToken();
        if (disposed) return;
        streamToken = String(streamSession.token || '').trim();
        if (!streamToken) {
          throw new Error('Missing stream token');
        }
      } catch (error) {
        if (disposed) return;
        console.error('Failed to connect admin alert stream:', error);
        scheduleReconnect(5000);
        return;
      }

      closeCurrentSource();
      const controller = new AbortController();
      streamAbortController = controller;
      let sawSessionExpired = false;

      try {
        await api.streamAdminOrdersEvents({
          streamToken,
          signal: controller.signal,
          onEvent: (eventName, rawData) => {
            if (disposed) return;
            if (eventName === 'orders_changed') {
              let payload: any = null;
              try {
                payload = JSON.parse(rawData);
              } catch {
                payload = null;
              }
              if (String(payload?.source || '').toLowerCase() === 'order_create') {
                setIsOpen(true);
              }
              return;
            }
            if (eventName === 'session_expired') {
              sawSessionExpired = true;
            }
          }
        });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        console.error('Admin alert stream closed with error:', error);
      }

      if (disposed || controller.signal.aborted) return;
      scheduleReconnect(sawSessionExpired ? 500 : 5000);
    };

    void connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      closeCurrentSource();
    };
  }, [isAuthenticated, user?.id, user?.role, location.pathname]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  if (!isAuthenticated || user?.role !== 'admin' || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-[140] bg-black/45 backdrop-blur-[1px] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-primary/20 shadow-2xl p-6 text-center">
        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary/15 text-primary grid place-items-center">
          <span className="material-symbols-outlined">notifications_active</span>
        </div>
        <p className="text-xl font-extrabold text-[#0d1c0d] dark:text-white">Order received!..</p>
        <p className="text-sm text-slate-500 mt-1">
          {nativeShell
            ? 'Native alarm is ringing. Tap Okay to stop it and open orders.'
            : 'New order just came in.'}
        </p>
        <button
          onClick={dismissAlert}
          className="mt-5 w-full py-2.5 rounded-xl bg-primary text-white font-bold hover:bg-primary/90 transition-colors"
        >
          Okay
        </button>
      </div>
    </div>
  );
};

export default AdminOrderAlert;
