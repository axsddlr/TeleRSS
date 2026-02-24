import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { HiChartBar, HiRss, HiBell, HiCog8Tooth, HiInformationCircle, HiSun, HiMoon, HiArrowRightOnRectangle } from 'react-icons/hi2';
import { useDarkMode } from '../lib/useDarkMode';
import { authStorage } from '../lib/api';
import AppLogo from './AppLogo';

const navItems = [
  { to: '/', label: 'Dashboard', icon: <HiChartBar className="w-5 h-5" /> },
  { to: '/feeds', label: 'Feeds', icon: <HiRss className="w-5 h-5" /> },
  { to: '/channels', label: 'Channels', icon: <HiBell className="w-5 h-5" /> },
  { to: '/settings', label: 'Settings', icon: <HiCog8Tooth className="w-5 h-5" /> },
  { to: '/about', label: 'About', icon: <HiInformationCircle className="w-5 h-5" /> },
];

export default function Layout() {
  const { dark, toggle } = useDarkMode();
  const navigate = useNavigate();

  function handleLogout() {
    authStorage.clearToken();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-900 dark:bg-gray-950 dark:border-r dark:border-gray-800 text-white flex flex-col">
        <div className="px-6 py-5 border-b border-gray-700 dark:border-gray-800">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <AppLogo className="w-6 h-6 rounded-md ring-1 ring-white/20" /> TeleRSS
          </h1>
          <p className="text-xs text-gray-400 mt-1">RSS to Telegram</p>
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
          <div className="flex items-center gap-2">
            <button onClick={handleLogout} title="Sign out" className="text-gray-400 hover:text-white transition-colors">
              <HiArrowRightOnRectangle className="w-5 h-5" />
            </button>
            <button
              onClick={toggle}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="text-gray-400 hover:text-white transition-colors"
            >
              {dark ? <HiSun className="w-5 h-5" /> : <HiMoon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
