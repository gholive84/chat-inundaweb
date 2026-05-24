import { useEffect, useState } from 'react';
import api from '../services/api';
import useAuthStore from '../store/authStore';

const STAGE_COLORS = {
  blue: '#3b82f6', yellow: '#facc15', purple: '#a855f7',
  green: '#22c55e', red: '#ef4444', gray: '#6b7280',
  indigo: '#6366f1', teal: '#14b8a6',
};

function SectionHeader({ title, count, action }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[9px] opacity-50" style={{ color: 'var(--inunda-text-faded)' }}>{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

function NavItem({ active, onClick, icon, label, count }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm"
      style={{
        background: active ? 'var(--inunda-cyan-faint)' : 'transparent',
        color: active ? 'var(--inunda-cyan)' : 'var(--inunda-text)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span className="flex items-center gap-2 min-w-0">
        <span className="flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      {count > 0 && (
        <span className="text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center flex-shrink-0"
          style={{ background: active ? 'var(--inunda-cyan)' : 'rgba(255,255,255,0.06)', color: active ? 'var(--inunda-bg-deep)' : 'var(--inunda-text-muted)' }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/**
 * Sidebar de navegação do chat: visualização, caixas e marcadores.
 * Filtros aplicados via callback onFilterChange({ view, instance_id, tag_id }).
 */
export default function InboxSidebar({ filter, onFilterChange }) {
  const { company, user } = useAuthStore();
  const [instances, setInstances] = useState([]);
  const [tags, setTags] = useState([]);
  const [counts, setCounts] = useState({ all: 0, me: 0, unassigned: 0 });
  const [defaultInstanceId, setDefaultInstanceId] = useState(null);

  useEffect(() => {
    api.get('/instances').then((r) => setInstances(r.data)).catch(() => {});
    api.get('/tags').then((r) => setTags(r.data)).catch(() => {});
    api.get('/companies/me').then((r) => setDefaultInstanceId(r.data?.prefs?.default_instance_id || null)).catch(() => {});
    // Counts: faz 3 queries leves
    Promise.all([
      api.get('/conversations?status=open'),
      api.get(`/conversations?status=open&assigned=me`),
      api.get('/conversations?status=open&assigned=unassigned'),
    ]).then(([all, me, un]) => {
      setCounts({ all: all.data.length, me: me.data.length, unassigned: un.data.length });
    }).catch(() => {});
  }, [filter?._refresh]);

  async function toggleFavorite(e, instanceId) {
    e.stopPropagation();
    const next = defaultInstanceId === instanceId ? null : instanceId;
    setDefaultInstanceId(next);
    try { await api.put('/companies/me/default-instance', { instance_id: next }); }
    catch (err) { /* reverte se falhar */
      setDefaultInstanceId(defaultInstanceId);
      alert(err.response?.data?.error || 'Falha ao salvar favorita');
    }
  }

  function set(patch) { onFilterChange({ ...filter, ...patch }); }

  // Detecta qual view esta ativa
  const isAllView = filter.view === 'all' && !filter.instance_id && !filter.tag_id;
  const isMeView = filter.view === 'me' && !filter.instance_id && !filter.tag_id;
  const isUnassigned = filter.view === 'unassigned' && !filter.instance_id && !filter.tag_id;

  return (
    <aside className="hidden md:flex w-60 flex-col flex-shrink-0 border-r overflow-y-auto"
      style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
      {/* Visualização atual */}
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--inunda-text-faded)' }}>
          Visualização atual
        </p>
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--inunda-text)' }}>
          {company?.name || '—'}
        </p>
      </div>

      {/* Visualizações principais */}
      <div className="p-2 space-y-0.5 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
        <NavItem
          active={isAllView}
          onClick={() => set({ view: 'all', instance_id: null, tag_id: null })}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
          label="Todas as conversas"
          count={counts.all} />
        <NavItem
          active={isMeView}
          onClick={() => set({ view: 'me', instance_id: null, tag_id: null })}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
          label="Minhas"
          count={counts.me} />
        <NavItem
          active={isUnassigned}
          onClick={() => set({ view: 'unassigned', instance_id: null, tag_id: null })}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>}
          label="Não atribuídas"
          count={counts.unassigned} />
      </div>

      {/* Caixas de Entrada */}
      <div className="border-b" style={{ borderColor: 'var(--inunda-border)' }}>
        <SectionHeader title="Caixas de Entrada" count={instances.length} />
        <div className="p-2 space-y-0.5">
          {instances.map((i) => {
            const isActive = String(filter.instance_id) === String(i.id);
            const isFav = defaultInstanceId === i.id;
            return (
              <div key={i.id}
                className="group w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm cursor-pointer"
                style={{
                  background: isActive ? 'var(--inunda-cyan-faint)' : 'transparent',
                  color: isActive ? 'var(--inunda-cyan)' : 'var(--inunda-text)',
                }}
                onClick={() => set({ instance_id: i.id, tag_id: null, view: 'all' })}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: i.status === 'connected' ? '#22c55e' : i.status === 'connecting' ? 'var(--inunda-cyan)' : '#6b7280' }} />
                  <span className="truncate">{i.display_name || i.instance_name}</span>
                </span>
                <button onClick={(e) => toggleFavorite(e, i.id)}
                  title={isFav ? 'Tirar dos favoritos (volta a abrir em Todas)' : 'Favoritar — sempre abre nessa caixa ao logar'}
                  className={`text-base leading-none flex-shrink-0 transition-opacity ${isFav ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 hover:opacity-100'}`}
                  style={{ color: isFav ? '#facc15' : 'var(--inunda-text-muted)' }}>
                  {isFav ? '★' : '☆'}
                </button>
              </div>
            );
          })}
          {instances.length === 0 && (
            <p className="text-[11px] italic px-3 py-1" style={{ color: 'var(--inunda-text-faded)' }}>
              Nenhuma caixa conectada
            </p>
          )}
        </div>
      </div>

      {/* Marcadores (tags) */}
      <div>
        <SectionHeader title="Marcadores" count={tags.length} />
        <div className="p-2 space-y-0.5">
          {tags.map((t) => (
            <NavItem key={t.id}
              active={String(filter.tag_id) === String(t.id)}
              onClick={() => set({ tag_id: t.id, instance_id: null, view: 'all' })}
              icon={<span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />}
              label={t.label} />
          ))}
          {tags.length === 0 && (
            <p className="text-[11px] italic px-3 py-1" style={{ color: 'var(--inunda-text-faded)' }}>
              Sem marcadores ainda
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
