import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Feed } from '../lib/api';
import FeedCard from '../components/FeedCard';
import AddFeedModal from '../components/AddFeedModal';
import EditFeedModal from '../components/EditFeedModal';

export default function Feeds() {
  const [showAdd, setShowAdd] = useState(false);
  const [editFeed, setEditFeed] = useState<Feed | null>(null);

  const { data: feeds = [], isLoading, error } = useQuery({
    queryKey: ['feeds'],
    queryFn: api.getFeeds,
    refetchInterval: 60_000,
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Feeds</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>+</span> Add Feed
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <div className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">Loading…</div>
        ) : error ? (
          <div className="px-6 py-8 text-center text-red-500">Failed to load feeds</div>
        ) : feeds.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
            No feeds yet. Click &ldquo;Add Feed&rdquo; to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    URL
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Interval
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Last Checked
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Subs
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
                {feeds.map((feed) => (
                  <FeedCard key={feed.id} feed={feed} onEdit={setEditFeed} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddFeedModal open={showAdd} onClose={() => setShowAdd(false)} />
      <EditFeedModal feed={editFeed} onClose={() => setEditFeed(null)} />
    </div>
  );
}
