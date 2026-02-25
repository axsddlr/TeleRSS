import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Subscription } from '../lib/api';
import AssignChatModal from '../components/AssignChatModal';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function BotConnectionCard() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['botStatus'],
    queryFn: api.getBotStatus,
    refetchInterval: 15_000,
  });

  const syncMutation = useMutation({
    mutationFn: api.syncBotChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['botChats'] });
      queryClient.invalidateQueries({ queryKey: ['botStatus'] });
    },
  });

  if (isLoading) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-500 dark:text-gray-400">
        Checking Telegram bot status...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mb-4 px-4 py-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
        Failed to load bot status.
      </div>
    );
  }

  const statusColor = data.connected
    ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
    : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200';
  const identity = data.username ? `@${data.username}` : data.botId ? `ID ${data.botId}` : 'unknown bot';

  return (
    <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${statusColor}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">
            {data.connected
              ? `Telegram connected as ${identity}`
              : data.connecting
                ? 'Telegram bot is connecting...'
                : 'Telegram bot is not connected'}
          </p>
          <p className="mt-1 text-xs opacity-90">
            Known chats: {data.knownChats}. Telegram cannot list all existing groups/channels automatically.
            Send one message in each chat after adding the bot, then click Sync.
          </p>
          {data.lastLaunchError && (
            <p className="mt-1 text-xs opacity-90">Last error: {data.lastLaunchError}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="px-3 py-1.5 rounded-md border border-current text-xs font-medium hover:bg-black/5 disabled:opacity-60"
        >
          {syncMutation.isPending ? 'Syncing...' : 'Sync'}
        </button>
      </div>
      {syncMutation.isError && (
        <p className="mt-2 text-xs">Sync failed: {(syncMutation.error as Error).message}</p>
      )}
      {syncMutation.isSuccess && (
        <p className="mt-2 text-xs">
          Sync complete: {syncMutation.data.updated} updated, {syncMutation.data.removed} removed.
        </p>
      )}
    </div>
  );
}

function SubRow({ sub }: { sub: Subscription }) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: () => api.toggleSubscription(sub.id, !sub.active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteSubscription(sub.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const handleDelete = () => {
    if (confirm(`Remove subscription for "${sub.feed.name}" → ${sub.chatId}?`)) {
      deleteMutation.mutate();
    }
  };

  return (
    <tr className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-sm text-gray-900 dark:text-white">{sub.feed.name}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">{sub.feed.url}</div>
      </td>
      <td className="px-4 py-3 text-sm font-mono text-gray-700 dark:text-gray-300">{sub.chatId}</td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{sub.chatName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{formatDate(sub.createdAt)}</td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            sub.active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              sub.active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          title="Remove subscription"
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
        >
          🗑️
        </button>
      </td>
    </tr>
  );
}

export default function Subscriptions() {
  const [showAssign, setShowAssign] = useState(false);

  const { data: subscriptions = [], isLoading, error } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: api.getSubscriptions,
    refetchInterval: 60_000,
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Channels</h2>
        <button
          onClick={() => setShowAssign(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>+</span> Assign Feed to Channel
        </button>
      </div>

      <BotConnectionCard />

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <div className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : error ? (
          <div className="px-6 py-8 text-center text-red-500">Failed to load channels</div>
        ) : subscriptions.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
            No channels yet. Add feeds first, then assign them to Telegram chats.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Feed
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Chat ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Chat Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Created
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Active
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <SubRow key={sub.id} sub={sub} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AssignChatModal open={showAssign} onClose={() => setShowAssign(false)} />
    </div>
  );
}
