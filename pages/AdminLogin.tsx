import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const AdminLogin: React.FC = () => {
  const { isAuthenticated, isLoading, user, signInWithAdminCredentials, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = (location.state as any)?.from || '/admin';

  useEffect(() => {
    if (isAuthenticated && user?.role === 'admin') {
      navigate(nextPath, { replace: true });
    }
  }, [isAuthenticated, user?.role, navigate, nextPath]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await signInWithAdminCredentials(email.trim(), password);
      navigate(nextPath, { replace: true });
    } catch (e: any) {
      setError(e?.message || 'Admin login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Checking session...</div>;
  }

  if (isAuthenticated && user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-[#e7f4e7] dark:border-white/10 shadow-xl p-8">
          <h1 className="text-2xl font-extrabold text-[#0d1c0d] dark:text-white">Admin Access Restricted</h1>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            You are currently signed in as a customer account. Please sign out first to continue with admin login.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={logout}
              className="flex-1 py-3 rounded-xl bg-primary text-background-dark font-bold hover:bg-primary/90 transition-colors"
            >
              Sign Out
            </button>
            <Link
              to="/"
              className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-zinc-700 text-center font-bold text-gray-700 dark:text-gray-200"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-[#e7f4e7] dark:border-white/10 shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-primary p-2 rounded-lg">
            <span className="material-symbols-outlined text-background-dark">shield_lock</span>
          </div>
          <h1 className="text-2xl font-extrabold">Admin Sign In</h1>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Sign in with your admin email and password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@takcakap.com"
              className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-primary text-background-dark font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In as Admin'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            Back to menu
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
