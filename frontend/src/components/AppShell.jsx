import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

function NavIcon({ to, label, children }) {
  return (
    <NavLink to={to} title={label}
      className={({ isActive }) =>
        `w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${isActive
          ? 'bg-cyan-400/15 text-cyan-300'
          : 'text-white/50 hover:text-white hover:bg-white/[0.06]'}`}>
      {children}
    </NavLink>
  );
}

export default function AppShell() {
  const navigate = useNavigate();
  const { user, company, logout } = useAuthStore();

  return (
    <div className="flex h-screen" style={{ background: 'var(--inunda-bg-deep)' }}>
      {/* Rail vertical */}
      <aside className="w-16 flex flex-col items-center py-4 gap-2 border-r"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <div className="mb-2">
          <img src="/inunda-logo.png" alt="" draggable={false} className="h-5 w-auto" />
        </div>
        <div className="flex-1 flex flex-col items-center gap-1.5 mt-3">
          <NavIcon to="/app/chat" label="Conversas">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </NavIcon>
          <NavIcon to="/app/crm" label="CRM">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          </NavIcon>
          <NavIcon to="/app/connect" label="WhatsApp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.5 8.5 0 0 1-7-3.5L3 21l4.5-2A8.5 8.5 0 1 1 21 11.5z"/>
            </svg>
          </NavIcon>
          <NavIcon to="/app/settings" label="Config">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </NavIcon>
        </div>

        <div className="flex flex-col items-center gap-2 mt-auto">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold"
            title={`${user?.name} · ${company?.name}`}
            style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <button onClick={() => { logout(); navigate('/login'); }} title="Sair"
            className="text-white/40 hover:text-white p-2 rounded-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
