import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useSocketStore from '../store/socketStore';
import api from '../services/api';

export default function UserMenu() {
  const navigate = useNavigate();
  const { user, company, companies, setAuth, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef(null);
  const isSuper = !!user?.is_super_admin;

  // Atualiza lista de empresas ao abrir (refresh)
  useEffect(() => {
    if (!open) return;
    api.get('/auth/companies').then((r) => {
      // Atualiza so a lista, mantendo o resto do auth state
      const cur = useAuthStore.getState();
      useAuthStore.setState({ ...cur, companies: r.data.companies || [] });
    }).catch(() => {});

    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function switchTo(c) {
    if (c.id === company?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      const { data } = await api.post('/auth/switch-company', { company_id: c.id });
      setAuth(data);
      useSocketStore.getState().disconnect();
      window.location.reload();
    } catch (e) { alert(e.response?.data?.error || 'Erro'); setSwitching(false); }
  }

  function doLogout() {
    if (!confirm('Sair da sua conta?')) return;
    useSocketStore.getState().disconnect();
    logout();
    navigate('/login');
  }

  if (!user) return null;
  const list = (companies && companies.length) ? companies : [{ id: company?.id, name: company?.name, role: user.role }];
  const showSwitcher = list.length > 1 || isSuper;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        title={`${user.name} · ${company?.name || ''}`}
        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-transform hover:ring-2 hover:ring-cyan-400/40"
        style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
        {user.name?.[0]?.toUpperCase() || '?'}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 rounded-xl shadow-2xl border z-50 overflow-hidden"
          style={{ background: 'var(--inunda-bg-elevated)', borderColor: 'var(--inunda-border)' }}>
          {/* Header com user info */}
          <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
              style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
              {user.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{user.name}</p>
                {isSuper && (
                  <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded"
                    style={{ background: 'rgba(168,85,247,0.18)', color: '#c084fc' }}>super</span>
                )}
              </div>
              <p className="text-xs truncate" style={{ color: 'var(--inunda-text-muted)' }}>{user.email}</p>
            </div>
          </div>

          {/* Switch empresas */}
          {showSwitcher && (
            <div className="border-b" style={{ borderColor: 'var(--inunda-border)' }}>
              <p className="px-4 py-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>
                Trocar empresa
              </p>
              <div className="max-h-60 overflow-y-auto">
                {list.map((c) => (
                  <button key={c.id} onClick={() => switchTo(c)}
                    disabled={switching}
                    className="w-full flex items-center gap-2.5 px-4 py-2 transition-colors disabled:opacity-50"
                    style={{ background: c.id === company?.id ? 'var(--inunda-cyan-faint)' : 'transparent' }}
                    onMouseEnter={(e) => { if (c.id !== company?.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { if (c.id !== company?.id) e.currentTarget.style.background = 'transparent'; }}>
                    <span className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                      style={{ background: 'var(--inunda-bg-surface)', color: 'var(--inunda-text)' }}>
                      {c.name?.[0]?.toUpperCase() || '?'}
                    </span>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm truncate" style={{ color: 'var(--inunda-text)' }}>{c.name}</p>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--inunda-text-faded)' }}>{c.role}</p>
                    </div>
                    {c.id === company?.id && <span style={{ color: 'var(--inunda-cyan)' }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Atalhos */}
          <button onClick={() => { setOpen(false); navigate('/app/settings'); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
            style={{ color: 'var(--inunda-text)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span className="text-sm">Configurações</span>
          </button>

          <button onClick={doLogout}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-red-500/10 border-t"
            style={{ color: '#ef4444', borderColor: 'var(--inunda-border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span className="text-sm font-medium">Sair</span>
          </button>
        </div>
      )}
    </div>
  );
}
