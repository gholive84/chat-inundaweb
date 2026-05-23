import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import useAuthStore from '../store/authStore';
import useSocketStore from '../store/socketStore';

export default function CompanySwitcher() {
  const { company, companies, setAuth, setCompanies } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const ref = useRef(null);

  // Refresh lista do backend ao abrir (caso tenha mudado)
  useEffect(() => {
    if (open) {
      api.get('/auth/companies').then((r) => setCompanies(r.data.companies || [])).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function switchTo(c) {
    if (c.id === company?.id) { setOpen(false); return; }
    try {
      const { data } = await api.post('/auth/switch-company', { company_id: c.id });
      setAuth(data);
      setOpen(false);
      // Reconnect socket com novo JWT
      useSocketStore.getState().disconnect();
      setTimeout(() => useSocketStore.getState().connect(), 50);
      // Reload da pagina pra resetar todo estado
      window.location.reload();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao trocar'); }
  }

  async function createCompany() {
    if (!newName.trim()) return;
    setError('');
    try {
      const { data } = await api.post('/auth/companies', { name: newName });
      setCompanies(data.companies);
      setNewName(''); setCreating(false);
      // Troca direto pra empresa nova
      await switchTo({ id: data.company.id });
    } catch (e) { setError(e.response?.data?.error || 'Erro'); }
  }

  if (!company) return null;
  const list = companies && companies.length ? companies : [{ id: company.id, name: company.name, role: 'owner' }];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors max-w-[200px]"
        title={`Empresa ativa: ${company.name}`}>
        <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold flex-shrink-0"
          style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
          {company.name?.[0]?.toUpperCase() || '?'}
        </span>
        <span className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{company.name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--inunda-text-muted)' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 rounded-xl shadow-2xl border z-50 overflow-hidden"
          style={{ background: 'var(--inunda-bg-elevated)', borderColor: 'var(--inunda-border)' }}>
          <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>
              Suas empresas ({list.length})
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {list.map((c) => (
              <button key={c.id} onClick={() => switchTo(c)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.04] transition-colors"
                style={{ background: c.id === company.id ? 'var(--inunda-cyan-faint)' : 'transparent' }}>
                <span className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold"
                  style={{ background: 'var(--inunda-bg-surface)', color: 'var(--inunda-text)' }}>
                  {c.name?.[0]?.toUpperCase() || '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{c.name}</p>
                  <p className="text-[10px] uppercase font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>{c.role}</p>
                </div>
                {c.id === company.id && (
                  <span style={{ color: 'var(--inunda-cyan)' }}>✓</span>
                )}
              </button>
            ))}
          </div>

          {creating ? (
            <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--inunda-border)' }}>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createCompany(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                placeholder="Nome da empresa..."
                className="w-full bg-white/5 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              <div className="flex gap-2">
                <button onClick={createCompany} disabled={!newName.trim()}
                  className="btn-primary text-xs px-3 py-1.5 rounded-md flex-1">Criar</button>
                <button onClick={() => { setCreating(false); setNewName(''); }}
                  className="text-xs px-2 py-1.5" style={{ color: 'var(--inunda-text-muted)' }}>×</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 border-t hover:bg-white/[0.04] transition-colors"
              style={{ borderColor: 'var(--inunda-border)', color: 'var(--inunda-cyan)' }}>
              <span className="w-7 h-7 rounded-md flex items-center justify-center text-base font-light"
                style={{ background: 'var(--inunda-cyan-faint)' }}>+</span>
              <span className="text-sm font-medium">Nova empresa</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
