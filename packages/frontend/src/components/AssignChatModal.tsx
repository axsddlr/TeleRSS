import { Dialog } from '@headlessui/react';
import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AssignChatModal({ open, onClose }: Props) {
  const [feedId, setFeedId] = useState('');
  const [chatId, setChatId] = useState('');
  const [chatName, setChatName] = useState('');
  const [error, setError] = useState('');
  const [manualMode, setManualMode] = useState(false);

  const queryClient = useQueryClient();

  const { data: feeds = [] } = useQuery({
    queryKey: ['feeds'],
    queryFn: api.getFeeds,
  });

  const {
    data: botChats = [],
    isLoading: chatsLoading,
  } = useQuery({
    queryKey: ['botChats'],
    queryFn: () => api.getBotChats(true),
    enabled: open,
  });

  // Auto-switch to manual if no chats discovered
  const effectiveManual = manualMode || (!chatsLoading && botChats.length === 0);

  const syncMutation = useMutation({
    mutationFn: api.syncBotChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['botChats'] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => api.createSubscription({ feedId, chatId, chatName: chatName || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      handleClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleClose = () => {
    setFeedId('');
    setChatId('');
    setChatName('');
    setError('');
    setManualMode(false);
    onClose();
  };

  const handleChatSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = botChats.find((c) => c.chatId === e.target.value);
    if (selected) {
      setChatId(selected.chatId);
      setChatName(selected.chatName);
    } else {
      setChatId('');
      setChatName('');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6">
          <Dialog.Title className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Assign Feed to Chat
          </Dialog.Title>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Feed
              </label>
              <select
                value={feedId}
                onChange={(e) => setFeedId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a feed…</option>
                {feeds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Telegram Chat
                </label>
                {!effectiveManual && (
                  <button
                    type="button"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 flex items-center gap-1"
                  >
                    {syncMutation.isPending ? (
                      <>
                        <span className="inline-block h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        Syncing…
                      </>
                    ) : (
                      '🔄 Sync'
                    )}
                  </button>
                )}
              </div>

              {effectiveManual ? (
                <>
                  <input
                    type="text"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="-1001234567890"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {botChats.length === 0 && !chatsLoading ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      No chats found — add the bot to a group first, then click{' '}
                      <button
                        type="button"
                        onClick={() => { setManualMode(false); syncMutation.mutate(); }}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Sync
                      </button>
                      .
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setManualMode(false)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
                    >
                      ← Back to dropdown
                    </button>
                  )}
                </>
              ) : (
                <>
                  <select
                    value={chatId}
                    onChange={handleChatSelect}
                    disabled={chatsLoading}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  >
                    <option value="">{chatsLoading ? 'Loading…' : 'Select a chat…'}</option>
                    {botChats.map((c) => (
                      <option key={c.chatId} value={c.chatId}>
                        {c.chatName} ({c.chatType})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setManualMode(true)}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:underline mt-1"
                  >
                    Enter manually
                  </button>
                </>
              )}
            </div>

            {effectiveManual && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Chat Name <span className="text-gray-400 dark:text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={chatName}
                  onChange={(e) => setChatName(e.target.value)}
                  placeholder="My News Group"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => assignMutation.mutate()}
              disabled={!feedId || !chatId || assignMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {assignMutation.isPending ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
