import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import useSocketStore from '../store/socketStore';
import ChatPanel from '../components/ChatPanel';
import ContactInfoPanel from '../components/ContactInfoPanel';
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
  const [activeConv, setActiveConv] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [assigned, setAssigned] = useState('all');
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [instances, setInstances] = useState([]);
  const [infoOpen, setInfoOpen] = useState(() => {
    try { return localStorage.getItem('chat_info_panel_open') !== 'false'; } catch { return true; }
  });
  const socket = useSocketStore((s) => s.socket) || useSocketStore.getState().connect();
  const activeId = parseInt(id);

  useEffect(() => { api.get('/instances').then((r) => setInstances(r.data)).catch(() => {}); }, []);

  function load() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (assigned !== 'all') params.set('assigned', assigned);
    if (search.trim()) params.set('search', search.trim());
    if (instanceFilter !== 'all') params.set('instance_id', instanceFilter);
    api.get(`/conversations?${params}`).then((r) => setItems(r.data)).catch(() => {});
  }
  // debounce search
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, assigned, search, instanceFilter]);

  useEffect(() => { try { localStorage.setItem('chat_info_panel_open', String(infoOpen)); } catch {} }, [infoOpen]);

  // Page title com contagem de unread
  useEffect(() => {
    const total = items.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    document.title = total > 0 ? `(${total}) Chat Inunda` : 'Chat Inunda';
    return () => { document.title = 'Chat Inunda'; };
  }, [items]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = () => load();
    const onNewMsg = (payload) => {
      load();
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

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className={`${activeId ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-shrink-0 border-r flex-col`}
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <div className="p-3 border-b space-y-2" style={{ borderColor: 'var(--inunda-border)' }}>
          <h2 className="font-semibold text-sm px-1" style={{ color: 'var(--inunda-text)' }}>Conversas</h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Buscar nome, número, msg..."
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
          <div className="flex gap-1">
            {[
              { v: 'all', l: 'Todos' },
              { v: 'me', l: 'Minhas' },
              { v: 'unassigned', l: 'Sem agente' },
            ].map((opt) => (
              <button key={opt.v} onClick={() => setAssigned(opt.v)}
                className="text-[11px] px-2 py-1 rounded-md transition-colors flex-1 border"
                style={{
                  background: assigned === opt.v ? 'var(--inunda-cyan-faint)' : 'transparent',
                  color: assigned === opt.v ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
                  borderColor: assigned === opt.v ? 'transparent' : 'var(--inunda-border)',
                }}>
                {opt.l}
              </button>
            ))}
          </div>
          {instances.length > 1 && (
            <select value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value)}
              className="w-full bg-white/5 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
              <option value="all">📦 Todas as caixas</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>📦 {i.display_name || i.instance_name}</option>
              ))}
            </select>
          )}
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
