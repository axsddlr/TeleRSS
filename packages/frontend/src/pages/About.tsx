import AppLogo from '../components/AppLogo';

const stack = [
  'Backend: Node.js + TypeScript + Express',
  'Frontend: React + Vite + Tailwind CSS',
  'Database: SQLite + Prisma',
  'Bot Delivery: Telegram + Telegraf',
  'Feed Polling: RSS Parser + node-cron',
];

export default function About() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <AppLogo className="w-14 h-14 rounded-2xl ring-1 ring-gray-200 dark:ring-gray-700" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">About TeleRSS</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            A self-hosted bridge that delivers RSS feed updates to Telegram chats.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            What It Does
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            TeleRSS watches your configured feeds, deduplicates items, and sends formatted posts to your
            assigned Telegram destinations automatically.
          </p>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Security
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            Access is protected with a single admin password, JWT auth for dashboard sessions, and local
            credential storage on the backend.
          </p>
        </section>
      </div>

      <section className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
          Stack
        </h3>
        <ul className="space-y-2">
          {stack.map(item => (
            <li key={item} className="text-sm text-gray-700 dark:text-gray-300">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
