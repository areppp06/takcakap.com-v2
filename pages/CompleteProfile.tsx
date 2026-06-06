import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';

const CompleteProfile: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const nextPath = (location.state as any)?.from || '/checkout';

  useEffect(() => {
    if (String(user?.phoneNumber || '').trim()) {
      navigate(nextPath, { replace: true });
    }
  }, [user?.phoneNumber, navigate, nextPath]);

  const handleSave = async () => {
    const trimmedPhone = phoneNumber.trim();
    if (!trimmedPhone) {
      setError('Phone number is required');
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      await updateProfile({ phoneNumber: trimmedPhone });
      navigate(nextPath, { replace: true });
    } catch (e: any) {
      setError(e?.message || 'Failed to update phone number');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-[#0d1c0d] dark:text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-[#e7f4e7] dark:border-white/10 shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" aria-label="Go to home">
            <BrandLogo
              alt="Brand logo"
              className="h-10 w-10 object-contain"
              fallbackIcon="person"
              fallbackIconClassName="material-symbols-outlined text-primary text-3xl"
            />
          </Link>
          <h1 className="text-2xl font-extrabold">Complete Profile</h1>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Please add your phone number before placing an order.
        </p>

        <div>
          <label className="block text-sm font-semibold mb-1">Phone Number</label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+60123456789"
            className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
        </div>

        {error && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="mt-6 w-full py-3 rounded-xl bg-primary text-background-dark font-bold hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save and Continue'}
        </button>
      </div>
    </div>
  );
};

export default CompleteProfile;
