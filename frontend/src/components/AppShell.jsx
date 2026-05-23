import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import CompanySwitcher from './CompanySwitcher';
import UserMenu from './UserMenu';

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
    <div className="flex flex-col md:flex-row h-screen" style={{ background: 'var(--inunda-bg-deep)' }}>
      {/* Rail vertical (desktop) */}
      <aside className="hidden md:flex w-16 flex-col items-center py-4 gap-2 border-r flex-shrink-0"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <div className="mb-2">
          <img src="/icone-chat.png" alt="Chat Inunda" draggable={false} className="h-7 w-auto" />
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
          <NavIcon to="/app/contacts" label="Contatos">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </NavIcon>
          <NavIcon to="/app/connect" label="WhatsApp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.5 8.5 0 0 1-7-3.5L3 21l4.5-2A8.5 8.5 0 1 1 21 11.5z"/>
            </svg>
          </NavIcon>
          {user?.is_super_admin && (
            <NavIcon to="/app/admin" label="Super Admin">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </NavIcon>
          )}
          <NavIcon to="/app/settings" label="Config">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </NavIcon>
        </div>

      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar com seletor de empresa + user menu */}
        <div className="hidden md:flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
          style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
          <CompanySwitcher />
          <UserMenu />
        </div>

        {/* Top bar mobile — logo + switcher + user menu */}
        <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2 border-b flex-shrink-0"
          style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
          <img src="/icone-chat.png" alt="Chat Inunda" className="h-6 w-auto" />
          <div className="flex-1 flex justify-end items-center gap-2">
            <CompanySwitcher />
            <UserMenu />
          </div>
        </div>

        <main className="flex-1 overflow-hidden min-h-0">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden flex border-t flex-shrink-0"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        {[
          { to: '/app/chat', label: 'Chat', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
          { to: '/app/crm', label: 'CRM', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
          { to: '/app/contacts', label: 'Contatos', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> },
          { to: '/app/settings', label: 'Config', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
        ].map((item) => (
          <NavLink key={item.to} to={item.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${isActive ? 'text-cyan-400' : 'text-white/50'}`}>
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
