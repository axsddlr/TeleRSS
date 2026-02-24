import { useState, FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HiCheckCircle } from 'react-icons/hi2';
import { api } from '../lib/api';

export default function ChangePassword() {
  const { data: authStatus } = useQuery({
    queryKey: ['authStatus'],
    queryFn: api.getAuthStatus,
  });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (next.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(current, next);
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Change Password</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Update the admin password used to sign in to TeleRSS.
      </p>

      {authStatus?.passwordFromEnv && (
        <div className="mb-5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Your password is set via the <code className="font-mono">ADMIN_PASSWORD</code> environment variable.
          Changes here will be saved to disk but the env var will take effect again on next restart.
          Remove <code className="font-mono">ADMIN_PASSWORD</code> from your <code className="font-mono">.env</code> to use the saved password permanently.
        </div>
      )}

      {success && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">
          <HiCheckCircle className="w-4 h-4 shrink-0" />
          Password updated successfully.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Current password
          </label>
          <input
            type="password"
            value={current}
            onChange={e => setCurrent(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            New password
          </label>
          <input
            type="password"
            value={next}
            onChange={e => setNext(e.target.value)}
            required
            minLength={8}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Confirm new password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
