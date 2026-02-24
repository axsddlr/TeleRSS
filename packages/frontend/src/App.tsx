import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Feeds from './pages/Feeds';
import Subscriptions from './pages/Subscriptions';
import Settings from './pages/Settings';
import OPMLImport from './components/OPMLImport';
import ChangePassword from './pages/ChangePassword';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import About from './pages/About';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="feeds" element={<Feeds />} />
          <Route path="channels" element={<Subscriptions />} />
          <Route path="subscriptions" element={<Navigate to="/channels" replace />} />
          <Route path="about" element={<About />} />
          <Route path="settings" element={<Settings />}>
            <Route path="import-opml" element={<OPMLImport />} />
            <Route path="change-password" element={<ChangePassword />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
