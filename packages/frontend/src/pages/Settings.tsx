import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { HiArrowUpTray } from 'react-icons/hi2';

const subNavItems = [
  { to: '/settings/import-opml', label: 'Import OPML', icon: <HiArrowUpTray className="w-4 h-4" /> },
];

export default function Settings() {
  const location = useLocation();
  const isRoot = location.pathname === '/settings' || location.pathname === '/settings/';

  return (
    <div className="flex h-full">
      {/* Sub-nav */}
      <aside className="w-48 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col py-4">
        <p className="px-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          Settings
        </p>
        {subNavItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-r-2 border-blue-600'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`
            }
          >
            {icon}
            {label}
          </NavLink>
        ))}
      </aside>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        {isRoot ? <Navigate to="/settings/import-opml" replace /> : <Outlet />}
      </div>
    </div>
  );
}

