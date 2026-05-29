import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import useSocketStore from '../store/socketStore';
import ChatPanel from '../components/ChatPanel';
import ContactInfoPanel from '../components/ContactInfoPanel';
import InboxSidebar from '../components/InboxSidebar';
import { relativeTime } from '../utils/relativeTime';
import { notify } from '../services/notifications';

function ConversationList({ items, activeId, onSelect, showInstance }) {
  return (
    <div className="overflow-y-auto h-full">
      {items.length === 0 && (
        <div className="text-center text-sm py-10 px-4" style={{ color: 'var(--inunda-text-faded)' }}>
          Nenhuma conversa ainda — conecte o WhatsApp em "WhatsApp" no menu lateral e aguarde a primeira mensagem
        </div>
      )}
      {items.map((c) => {
        const active = c.id === activeId;
        const name = c.contact_name || c.push_name || c.phone;
        return (
          <button key={c.id} onClick={() => onSelect(c.id)}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b ${active ? '' : 'hover:bg-white/[0.03]'}`}
            style={{ borderColor: 'var(--inunda-border)', background: active ? 'var(--inunda-cyan-faint)' : 'transparent' }}>
            {c.profile_pic_url ? (
              <img src={c.profile_pic_url} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
                {name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {c.is_urgent && (
                    <span title="Urgente" className="flex-shrink-0">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" strokeWidth="2">
                        <path d="M12 2L1 21h22L12 2z"/><line x1="12" y1="9" x2="12" y2="13" stroke="#fff"/><circle cx="12" cy="17" r="0.5" fill="#fff"/>
                      </svg>
                    </span>
                  )}
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{name}</p>
                </div>
                <span className="text-[10px] flex-shrink-0" style={{ color: c.unread_count > 0 ? 'var(--inunda-cyan)' : 'var(--inunda-text-faded)' }}>
                  {relativeTime(c.last_message_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className="text-xs truncate flex-1" style={{ color: 'var(--inunda-text-muted)' }}>
                  {c.last_message_preview || '—'}
                </p>
                {c.unread_count > 0 && (
                  <span className="text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--inunda-cyan)', color: 'var(--inunda-bg-deep)' }}>
                    {c.unread_count}
                  </span>
                )}
              </div>
              {showInstance && c.instance_label && (
                <span className="inline-block text-[9px] uppercase tracking-wider mt-1 px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--inunda-text-faded)' }}>
                  📦 {c.instance_label}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [instances, setInstances] = useState([]);
  const [sidebarTick, setSidebarTick] = useState(0); // refresh dos counts da InboxSidebar
  const [activeConv, setActiveConv] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  // Filtro unificado da InboxSidebar: { view: 'all'|'me'|'unassigned', instance_id, tag_id }
  const [filter, setFilter] = useState({ view: 'all', instance_id: null, tag_id: null });
  const [infoOpen, setInfoOpen] = useState(() => {
    try { return localStorage.getItem('chat_info_panel_open') !== 'false'; } catch { return true; }
  });
  const socket = useSocketStore((s) => s.socket) || useSocketStore.getState().connect();
  const activeId = parseInt(id);

  useEffect(() => { api.get('/instances').then((r) => setInstances(r.data)).catch(() => {}); }, []);

  // Aplica caixa favorita do user como filtro inicial (so na 1a carga)
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (appliedDefaultRef.current) return;
    api.get('/companies/me').then((r) => {
      const def = r.data?.prefs?.default_instance_id;
      if (def && !filter.instance_id) {
        setFilter({ view: 'all', instance_id: def, tag_id: null });
      }
      appliedDefaultRef.current = true;
    }).catch(() => { appliedDefaultRef.current = true; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (filter.view === 'me') params.set('assigned', 'me');
    else if (filter.view === 'unassigned') params.set('assigned', 'unassigned');
    if (search.trim()) params.set('search', search.trim());
    if (filter.instance_id) params.set('instance_id', filter.instance_id);
    if (filter.tag_id) params.set('tag_id', filter.tag_id);
    api.get(`/conversations?${params}`).then((r) => setItems(r.data)).catch(() => {});
  }
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, filter]);

  useEffect(() => { try { localStorage.setItem('chat_info_panel_open', String(infoOpen)); } catch {} }, [infoOpen]);

  // Page title com contagem de unread
  useEffect(() => {
    const total = items.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    document.title = total > 0 ? `(${total}) Chat Inunda` : 'Chat Inunda';
    return () => { document.title = 'Chat Inunda'; };
  }, [items]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = () => { load(); setSidebarTick((x) => x + 1); };
    const onNewMsg = (payload) => {
      load();
      setSidebarTick((x) => x + 1);
      // Notifica se conversa nao e a ativa e msg veio do contato
      if (payload?.message && !payload.message.from_me && payload.conversationId !== activeId) {
        // Busca o nome do contato pra mostrar
        const conv = items.find((c) => c.id === payload.conversationId);
        const who = conv?.contact_name || conv?.push_name || conv?.phone || 'Mensagem nova';
        notify({
          title: who,
          body: payload.message.body || '[mídia]',
          tag: `conv-${payload.conversationId}`,
          onClick: () => navigate(`/app/chat/${payload.conversationId}`),
        });
      }
    };
    socket.on('conversation:update', onUpdate);
    socket.on('message:new', onNewMsg);
    return () => {
      socket.off('conversation:update', onUpdate);
      socket.off('message:new', onNewMsg);
    };
  }, [socket, activeId, items, navigate]);

  // Label do header da lista — reflete o filtro ativo da sidebar
  const headerLabel = filter.instance_id
    ? `📦 ${instances.find((i) => i.id === filter.instance_id)?.display_name || 'Caixa'}`
    : filter.tag_id
    ? '🏷 Marcador'
    : filter.view === 'me' ? 'Minhas' : filter.view === 'unassigned' ? 'Não atribuídas' : 'Conversas';

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar caixas + marcadores (so desktop) */}
      <InboxSidebar filter={{ ...filter, _refresh: sidebarTick }} onFilterChange={setFilter} />

      {/* Lista de conversas */}
      <div className={`${activeId ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-shrink-0 border-r flex-col`}
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <div className="p-3 border-b space-y-2" style={{ borderColor: 'var(--inunda-border)' }}>
          <h2 className="font-semibold text-sm px-1 flex items-center gap-2" style={{ color: 'var(--inunda-text)' }}>
            <span className="truncate">{headerLabel}</span>
            <span className="text-[10px] font-normal" style={{ color: 'var(--inunda-text-faded)' }}>{items.length}</span>
          </h2>
          {/* Seletor de caixa MOBILE (desktop usa InboxSidebar) */}
          {instances.length > 0 && (
            <select
              className="md:hidden w-full bg-white/5 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}
              value={filter.instance_id || ''}
              onChange={(e) => {
                const v = e.target.value;
                setFilter({ ...filter, instance_id: v ? parseInt(v) : null, tag_id: null, view: 'all' });
              }}>
              <option value="">📦 Todas as caixas</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>📦 {i.display_name || i.instance_name}</option>
              ))}
            </select>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Buscar..."
            className="w-full bg-white/5 border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
          <div className="flex gap-1">
            {[
              { v: 'open', l: 'Abertas' },
              { v: 'resolved', l: 'Resolvidas' },
              { v: 'all', l: 'Todas' },
            ].map((opt) => (
              <button key={opt.v} onClick={() => setStatus(opt.v)}
                className="text-[11px] px-2 py-1 rounded-md transition-colors flex-1"
                style={{
                  background: status === opt.v ? 'var(--inunda-cyan-faint)' : 'transparent',
                  color: status === opt.v ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
                }}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <ConversationList items={items} activeId={activeId}
          showInstance={instances.length > 1}
          onSelect={(cid) => navigate(`/app/chat/${cid}`)} />
      </div>

      {/* Painel central */}
      {activeId ? (
        <>
          <ChatPanel
            conversationId={activeId}
            onBack={() => navigate('/app/chat')}
            onConvLoaded={setActiveConv}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            infoOpen={infoOpen}
          />
          {infoOpen && activeConv && (
            <ContactInfoPanel
              conv={activeConv}
              onConvUpdate={(patch) => setActiveConv((p) => ({ ...p, ...patch }))}
              onClose={() => setInfoOpen(false)}
            />
          )}
        </>
      ) : (
        <div className="hidden md:flex flex-1 flex-col items-center justify-center text-center p-8"
          style={{ background: 'var(--inunda-bg-deep)', color: 'var(--inunda-text-muted)' }}>
          <img src="/icone-chat.png" className="h-12 w-auto mb-4 opacity-60" />
          <p className="text-sm">Selecione uma conversa pra começar</p>
        </div>
      )}
    </div>
  );
}
