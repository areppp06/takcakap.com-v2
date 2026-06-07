import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

const Login: React.FC = () => {
  const { isAuthenticated, signInWithGoogleCredential } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const nextPath = (location.state as any)?.from || '/';
  const [googleClientId, setGoogleClientId] = useState<string>(
    import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
  );

  useEffect(() => {
    if (googleClientId) return;

    fetch('/api/config/google')
      .then((res) => res.json())
      .then((data) => {
        if (data.googleClientId) {
          setGoogleClientId(data.googleClientId);
          setError('');
        } else {
          setError('Google login is not configured. Missing VITE_GOOGLE_CLIENT_ID.');
        }
      })
      .catch(() => {
        setError('Google login is not configured. Missing VITE_GOOGLE_CLIENT_ID.');
      });
  }, [googleClientId]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(nextPath, { replace: true });
    }
  }, [isAuthenticated, navigate, nextPath]);

  useEffect(() => {
    if (!googleClientId) {
      // Don't show the error immediately while fetching
      return;
    }

    const initializeGoogle = () => {
      if (!window.google || !buttonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: any) => {
          if (!response?.credential) {
            setError('Google login did not return credential token.');
            return;
          }
          try {
            setError('');
            setIsBusy(true);
            await signInWithGoogleCredential(response.credential);
            navigate(nextPath, { replace: true });
          } catch (e: any) {
            setError(e?.message || 'Google sign-in failed');
          } finally {
            setIsBusy(false);
          }
        }
      });

      buttonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 320
      });
    };

    if (window.google) {
      initializeGoogle();
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    script.onerror = () => setError('Failed to load Google sign-in script');
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [googleClientId, navigate, nextPath, signInWithGoogleCredential]);

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-[#e7f4e7] dark:border-white/10 shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-primary p-2 rounded-lg">
            <span className="material-symbols-outlined text-background-dark">lock</span>
          </div>
          <h1 className="text-2xl font-extrabold">Sign In</h1>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Please sign in with Google before placing an order.
        </p>

        <div className="flex justify-center">
          <div ref={buttonRef} />
        </div>

        {isBusy && (
          <p className="text-sm text-primary text-center mt-4">Signing you in...</p>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            Back to menu
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
