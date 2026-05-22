import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import Login from './pages/Login';
import Signup from './pages/Signup';
import AppShell from './components/AppShell';
import Chat from './pages/Chat';
import Crm from './pages/Crm';
import Settings from './pages/Settings';
import Connect from './pages/Connect';

function Guard({ children }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"  element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route path="/app" element={<Guard><AppShell /></Guard>}>
        <Route index element={<Navigate to="chat" replace />} />
        <Route path="chat"    element={<Chat />} />
        <Route path="chat/:id" element={<Chat />} />
        <Route path="crm"     element={<Crm />} />
        <Route path="settings" element={<Settings />} />
        <Route path="connect" element={<Connect />} />
      </Route>

      <Route path="*" element={<Navigate to="/app/chat" replace />} />
    </Routes>
  );
}
