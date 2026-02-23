import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HiArrowPath, HiArrowUpTray, HiPencil, HiTrash } from 'react-icons/hi2';
import { Feed, api } from '../lib/api';

interface Props {
  feed: Feed;
  onEdit: (feed: Feed) => void;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

export default function FeedCard({ feed, onEdit }: Props) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: () => api.updateFeed(feed.id, { active: !feed.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feeds'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteFeed(feed.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.refreshFeed(feed.id),
  });

  const forcePushMutation = useMutation({
    mutationFn: () => api.forcePushFeed(feed.id),
  });

  const handleForcePush = () => {
    if (
      confirm(
        `Force-push "${feed.name}"?\n\nThis clears the delivered history and re-sends all current feed items to every subscribed chat.`,
      )
    ) {
      forcePushMutation.mutate();
    }
  };

  const handleDelete = () => {
    if (confirm(`Delete feed "${feed.name}"? This will also remove all subscriptions.`)) {
      deleteMutation.mutate();
    }
  };

  return (
    <tr className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-white text-sm">{feed.name}</div>
        {feed.description && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">{feed.description}</div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-xs">
        <a
          href={feed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-blue-600 dark:hover:text-blue-400 truncate block"
        >
          {feed.url}
        </a>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 text-center">
        {feed.checkInterval}m
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
        {formatDate(feed.lastCheckedAt)}
      </td>
      <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-300">
        {feed._count?.subscriptions ?? 0}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            feed.active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              feed.active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            title="Check for new articles now"
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
          >
            <HiArrowPath className={`w-4 h-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleForcePush}
            disabled={forcePushMutation.isPending}
            title="Force-push: clear history and re-send all articles"
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded transition-colors"
          >
            <HiArrowUpTray className={`w-4 h-4 ${forcePushMutation.isPending ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onEdit(feed)}
            title="Edit feed"
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <HiPencil className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            title="Delete feed"
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
          >
            <HiTrash className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
