import { NavLink, Outlet } from 'react-router-dom';
import { HiChartBar, HiRss, HiBell, HiCog8Tooth, HiNewspaper, HiSun, HiMoon } from 'react-icons/hi2';
import { useDarkMode } from '../lib/useDarkMode';

const navItems = [
  { to: '/', label: 'Dashboard', icon: <HiChartBar className="w-5 h-5" /> },
  { to: '/feeds', label: 'Feeds', icon: <HiRss className="w-5 h-5" /> },
  { to: '/subscriptions', label: 'Subscriptions', icon: <HiBell className="w-5 h-5" /> },
  { to: '/settings', label: 'Settings', icon: <HiCog8Tooth className="w-5 h-5" /> },
];

export default function Layout() {
  const { dark, toggle } = useDarkMode();

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-900 dark:bg-gray-950 dark:border-r dark:border-gray-800 text-white flex flex-col">
        <div className="px-6 py-5 border-b border-gray-700 dark:border-gray-800">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <HiNewspaper className="w-5 h-5" /> TeleRSS
          </h1>
          <p className="text-xs text-gray-400 mt-1">RSS → Telegram</p>
        </div>

        <nav className="flex-1 py-4">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-6 py-4 border-t border-gray-700 dark:border-gray-800 flex items-center justify-between">
          <p className="text-xs text-gray-500">TeleRSS v1.0</p>
          <button
            onClick={toggle}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {dark ? <HiSun className="w-5 h-5" /> : <HiMoon className="w-5 h-5" />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
