import { useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HiFolderArrowDown, HiArrowPath, HiChevronUp, HiChevronDown } from 'react-icons/hi2';
import { api, Feed } from '../lib/api';

interface OPMLFeed {
  name: string;
  url: string;
  category: string;
}

interface ReviewFeed extends OPMLFeed {
  selected: boolean;
  checkInterval: number;
}

interface ImportResult {
  imported: Feed[];
  skipped: Array<{ url: string; reason: string }>;
  failed: Array<{ url: string; reason: string }>;
}

function parseOPML(xml: string): OPMLFeed[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const feeds: OPMLFeed[] = [];
  doc.querySelectorAll('outline[xmlUrl]').forEach((el) => {
    feeds.push({
      name: el.getAttribute('text') || el.getAttribute('title') || '',
      url: el.getAttribute('xmlUrl') || '',
      category: el.parentElement?.getAttribute('text') || '',
    });
  });
  return feeds.filter((f) => f.url);
}

type Step = 'upload' | 'review' | 'results';

export default function OPMLImport() {
  const [step, setStep] = useState<Step>('upload');
  const [isDragOver, setIsDragOver] = useState(false);
  const [parseError, setParseError] = useState('');
  const [reviewFeeds, setReviewFeeds] = useState<ReviewFeed[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [failedOpen, setFailedOpen] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [selectedChatName, setSelectedChatName] = useState('');
  const [assignSuccess, setAssignSuccess] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: botChats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ['botChats'],
    queryFn: () => api.getBotChats(true),
    enabled: step === 'results',
  });

  const syncMutation = useMutation({
    mutationFn: api.syncBotChats,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['botChats'] }),
  });

  const importMutation = useMutation({
    mutationFn: (feeds: Array<{ url: string; name: string; checkInterval: number }>) =>
      api.importFeeds(feeds),
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      setStep('results');
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: () =>
      api.bulkCreateSubscriptions({
        feedIds: (importResult?.imported ?? []).map((f) => f.id),
        chatId: selectedChatId,
        chatName: selectedChatName || undefined,
      }),
    onSuccess: (result) => {
      setAssignSuccess(result.created);
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const processFile = useCallback((file: File) => {
    setParseError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const xml = e.target?.result as string;
      const feeds = parseOPML(xml);
      if (feeds.length === 0) {
        setParseError('No RSS feeds found in this OPML file.');
        return;
      }
      setReviewFeeds(
        feeds.map((f) => ({ ...f, selected: true, checkInterval: 15 }))
      );
      setStep('review');
    };
    reader.readAsText(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const allSelected = reviewFeeds.every((f) => f.selected);
  const someSelected = reviewFeeds.some((f) => f.selected);
  const selectedCount = reviewFeeds.filter((f) => f.selected).length;

  const toggleAll = () => {
    setReviewFeeds((prev) => prev.map((f) => ({ ...f, selected: !allSelected })));
  };

  const toggleOne = (index: number) => {
    setReviewFeeds((prev) =>
      prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f))
    );
  };

  const updateName = (index: number, name: string) => {
    setReviewFeeds((prev) => prev.map((f, i) => (i === index ? { ...f, name } : f)));
  };

  const updateInterval = (index: number, val: string) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 1 && n <= 1440) {
      setReviewFeeds((prev) =>
        prev.map((f, i) => (i === index ? { ...f, checkInterval: n } : f))
      );
    }
  };

  const handleImport = () => {
    const toImport = reviewFeeds
      .filter((f) => f.selected)
      .map(({ url, name, checkInterval }) => ({ url, name, checkInterval }));
    importMutation.mutate(toImport);
  };

  const handleChatSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chat = botChats.find((c) => c.chatId === e.target.value);
    if (chat) {
      setSelectedChatId(chat.chatId);
      setSelectedChatName(chat.chatName);
    } else {
      setSelectedChatId('');
      setSelectedChatName('');
    }
  };

  const resetWizard = () => {
    setStep('upload');
    setReviewFeeds([]);
    setImportResult(null);
    setFailedOpen(false);
    setSelectedChatId('');
    setSelectedChatName('');
    setAssignSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Step 1: Upload ---
  if (step === 'upload') {
    return (
      <div className="max-w-xl">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Import OPML</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Upload an OPML file exported from your RSS reader to import feeds in bulk.
        </p>

        {parseError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {parseError}
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
          }`}
        >
          <HiFolderArrowDown className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-3" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Drop your OPML file here, or click to browse
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            .opml or .xml files
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".opml,.xml"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>
    );
  }

  // --- Step 2: Review ---
  if (step === 'review') {
    return (
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Review Feeds</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {reviewFeeds.length} feeds found. Deselect any you don't want to import.
            </p>
          </div>
          <button
            onClick={resetWizard}
            className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
          >
            ← Start over
          </button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Name</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">URL</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Category</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300 w-24">
                  Interval (min)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {reviewFeeds.map((feed, i) => (
                <tr
                  key={i}
                  className={`${
                    feed.selected
                      ? 'bg-white dark:bg-gray-900'
                      : 'bg-gray-50 dark:bg-gray-800 opacity-50'
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={feed.selected}
                      onChange={() => toggleOne(i)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={feed.name}
                      onChange={(e) => updateName(i, e.target.value)}
                      className="w-full px-2 py-1 border border-transparent focus:border-gray-300 dark:focus:border-gray-600 rounded bg-transparent focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-white focus:outline-none text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs max-w-xs truncate">
                    {feed.url}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {feed.category || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={feed.checkInterval}
                      onChange={(e) => updateInterval(i, e.target.value)}
                      className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {importMutation.isError && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {(importMutation.error as Error).message}
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {selectedCount} of {reviewFeeds.length} selected
          </p>
          <button
            onClick={handleImport}
            disabled={selectedCount === 0 || importMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {importMutation.isPending ? (
              <>
                <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Importing…
              </>
            ) : (
              `Import ${selectedCount} feed${selectedCount !== 1 ? 's' : ''}`
            )}
          </button>
        </div>
      </div>
    );
  }

  // --- Step 3: Results ---
  const result = importResult!;
  const hasImported = result.imported.length > 0;

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Import Complete</h2>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-center">
          <div className="text-2xl font-bold text-green-700 dark:text-green-400">{result.imported.length}</div>
          <div className="text-xs text-green-600 dark:text-green-500 mt-1">Imported</div>
        </div>
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl text-center">
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{result.skipped.length}</div>
          <div className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">Skipped (duplicates)</div>
        </div>
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-center">
          <div className="text-2xl font-bold text-red-700 dark:text-red-400">{result.failed.length}</div>
          <div className="text-xs text-red-600 dark:text-red-500 mt-1">Failed</div>
        </div>
      </div>

      {/* Failed list (collapsible) */}
      {result.failed.length > 0 && (
        <div className="mb-6 border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setFailedOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 bg-red-50 dark:bg-red-900/20 text-sm font-medium text-red-700 dark:text-red-400"
          >
            <span>Failed feeds ({result.failed.length})</span>
            {failedOpen ? <HiChevronUp className="w-4 h-4" /> : <HiChevronDown className="w-4 h-4" />}
          </button>
          {failedOpen && (
            <ul className="divide-y divide-red-100 dark:divide-red-900">
              {result.failed.map((f) => (
                <li key={f.url} className="px-4 py-2 text-xs text-gray-700 dark:text-gray-300">
                  <span className="font-mono break-all">{f.url}</span>
                  <span className="ml-2 text-red-500">— {f.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Assign to chat */}
      {hasImported && assignSuccess === null && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
            Assign imported feeds to a chat
          </h3>

          <div className="flex items-center gap-2 mb-3">
            <select
              value={selectedChatId}
              onChange={handleChatSelect}
              disabled={chatsLoading}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              <option value="">{chatsLoading ? 'Loading…' : 'Select a chat…'}</option>
              {botChats.map((c) => (
                <option key={c.chatId} value={c.chatId}>
                  {c.chatName} ({c.chatType})
                </option>
              ))}
            </select>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              {syncMutation.isPending ? (
                <>
                  <span className="inline-block h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Syncing…
                </>
              ) : (
                <><HiArrowPath className="w-3 h-3" /> Sync</>
              )}
            </button>
          </div>

          {bulkAssignMutation.isError && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">
              {(bulkAssignMutation.error as Error).message}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => bulkAssignMutation.mutate()}
              disabled={!selectedChatId || bulkAssignMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {bulkAssignMutation.isPending ? (
                <>
                  <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Assigning…
                </>
              ) : (
                `Assign ${result.imported.length} feed${result.imported.length !== 1 ? 's' : ''} to this chat`
              )}
            </button>
            <button
              onClick={() => setAssignSuccess(-1)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Assign success */}
      {assignSuccess !== null && assignSuccess >= 0 && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-700 dark:text-green-400">
          {assignSuccess} subscription{assignSuccess !== 1 ? 's' : ''} created.{' '}
          <Link to="/subscriptions" className="font-medium underline">
            Go to Subscriptions →
          </Link>
        </div>
      )}

      <button
        onClick={resetWizard}
        className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
      >
        Import another file
      </button>
    </div>
  );
}
