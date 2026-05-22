import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import useSocketStore from '../store/socketStore';
import useAutoScroll from '../hooks/useAutoScroll';

function formatTime(d) {
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function authorLabel(m) {
  if (m.author_type === 'ai') return 'IA';
  if (m.author_type === 'agent') return m.author_name || 'Agente';
  return '';
}

function Bubble({ m }) {
  const fromMe = !!m.from_me;
  const isAI = m.author_type === 'ai';
  return (
    <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] px-3 py-2 rounded-lg shadow-sm text-sm ${
        fromMe
          ? (isAI ? 'bg-purple-600/90 text-white' : 'bg-emerald-600 text-white')
          : 'bg-white/[0.06] text-white border border-white/10'
      }`} style={{ wordBreak: 'break-word' }}>
        {fromMe && isAI && (
          <p className="text-[10px] uppercase tracking-wider opacity-80 font-semibold mb-0.5">🤖 IA</p>
        )}
        {fromMe && m.author_type === 'agent' && (
          <p className="text-[10px] uppercase tracking-wider opacity-80 font-semibold mb-0.5">{authorLabel(m)}</p>
        )}
        <p className="whitespace-pre-wrap leading-snug">{m.body}</p>
        <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
          <span className={`text-[10px] ${fromMe ? 'text-white/70' : 'text-white/40'}`}>{formatTime(m.created_at)}</span>
          {fromMe && m.status === 'sent' && <span className="text-[10px] text-white/70">✓</span>}
          {fromMe && m.status === 'delivered' && <span className="text-[10px] text-white/70">✓✓</span>}
          {fromMe && m.status === 'read' && <span className="text-[10px] text-cyan-300">✓✓</span>}
          {fromMe && m.status === 'failed' && <span className="text-[10px] text-red-300" title={m.error || 'falha'}>⚠</span>}
          {fromMe && m.status === 'pending' && <span className="text-[10px] text-white/40">⏳</span>}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel({ conversationId, onBack, onConvLoaded, onToggleInfo, infoOpen }) {
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiToggling, setAiToggling] = useState(false);
  const socket = useSocketStore((s) => s.socket) || useSocketStore.getState().connect();
  const typingTimer = useRef(null);
  const bottomRef = useAutoScroll([messages.length], conversationId);

  // Carrega conversa + mensagens; junta na sala via socket
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const [cRes, mRes] = await Promise.all([
          api.get(`/conversations/${conversationId}`),
          api.get(`/messages/${conversationId}`),
        ]);
        if (cancelled) return;
        setConv(cRes.data);
        onConvLoaded?.(cRes.data);
        setMessages(mRes.data);
        await api.post(`/conversations/${conversationId}/read`).catch(() => {});
      } catch (err) { console.error(err); }
    })();

    socket?.emit('join_conversation', { conversationId });
    const onNew = ({ conversationId: id }) => {
      if (id !== conversationId) return;
      // Refetch ultimas msgs (mais simples que merge perfeito)
      api.get(`/messages/${conversationId}`).then((r) => setMessages(r.data)).catch(() => {});
    };
    socket?.on('message:new', onNew);
    return () => {
      cancelled = true;
      socket?.emit('leave_conversation', { conversationId });
      socket?.off('message:new', onNew);
    };
  }, [conversationId, socket]);

  // Sinaliza typing pro backend (pausa IA)
  function onTyping(value) {
    setText(value);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    // Manda pausa toda vez (com debounce) — backend reseta o ai_paused_until
    typingTimer.current = setTimeout(() => {
      api.post(`/conversations/${conversationId}/ai-pause`, { seconds: 600 }).catch(() => {});
      socket?.emit('agent_typing', { conversationId });
    }, 500);
  }

  async function send(e) {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.post(`/messages/${conversationId}`, { body: text });
      setText('');
      // refetch
      const r = await api.get(`/messages/${conversationId}`);
      setMessages(r.data);
    } catch (err) {
      alert(err.response?.data?.error || 'Falha ao enviar');
    } finally { setSending(false); }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
  }

  async function toggleAI() {
    if (!conv) return;
    setAiToggling(true);
    try {
      await api.post(`/conversations/${conversationId}/ai-toggle`, { enabled: !conv.ai_enabled });
      setConv((p) => ({ ...p, ai_enabled: !p.ai_enabled, ai_paused_until: null }));
    } finally { setAiToggling(false); }
  }

  async function resolveConv() {
    if (!confirm('Marcar conversa como resolvida?')) return;
    try {
      await api.post(`/conversations/${conversationId}/status`, { status: 'resolved' });
      setConv((p) => ({ ...p, status: 'resolved' }));
    } catch (err) { alert(err.response?.data?.error || 'Erro'); }
  }
  async function reopenConv() {
    try {
      await api.post(`/conversations/${conversationId}/status`, { status: 'open' });
      setConv((p) => ({ ...p, status: 'open' }));
    } catch {}
  }

  if (!conv) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--inunda-text-muted)' }}>
        <p className="text-sm">Carregando…</p>
      </div>
    );
  }

  const contactName = conv.contact_name || conv.push_name || conv.phone;
  const aiPausedUntil = conv.ai_paused_until ? new Date(conv.ai_paused_until) : null;
  const aiPaused = aiPausedUntil && aiPausedUntil > new Date();

  return (
    <div className="flex-1 flex flex-col h-full" style={{ background: 'var(--inunda-bg-deep)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        {onBack && (
          <button onClick={onBack} className="md:hidden text-white/60 hover:text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        {conv.profile_pic_url ? (
          <img src={conv.profile_pic_url} className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
            {contactName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{contactName}</p>
          <p className="text-xs font-mono-inunda" style={{ color: 'var(--inunda-text-faded)' }}>{conv.phone}</p>
        </div>
        {conv.status === 'resolved' ? (
          <button onClick={reopenConv}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
            ↺ Reabrir
          </button>
        ) : (
          <button onClick={resolveConv}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
            ✓ Resolver
          </button>
        )}
        <button onClick={toggleAI} disabled={aiToggling}
          title={conv.ai_enabled ? (aiPaused ? 'IA pausada (agente ativo)' : 'IA ativa — clique pra desativar') : 'IA desativada — clique pra ativar'}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
          style={{
            background: conv.ai_enabled ? (aiPaused ? 'rgba(251,191,36,0.15)' : 'rgba(168,85,247,0.18)') : 'rgba(255,255,255,0.06)',
            color: conv.ai_enabled ? (aiPaused ? '#fbbf24' : '#c084fc') : 'var(--inunda-text-muted)',
          }}>
          <span>🤖</span>
          <span>{conv.ai_enabled ? (aiPaused ? 'IA pausada' : 'IA ON') : 'IA OFF'}</span>
        </button>
        {onToggleInfo && (
          <button onClick={onToggleInfo}
            title={infoOpen ? 'Esconder info' : 'Mostrar info'}
            className="p-2 rounded-lg transition-colors"
            style={{
              background: infoOpen ? 'var(--inunda-cyan-faint)' : 'transparent',
              color: infoOpen ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ background: 'var(--inunda-bg-deep)' }}>
        {messages.length === 0 && (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--inunda-text-faded)' }}>
            Sem mensagens ainda
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={bottomRef} />
      </div>

      {/* Banner pausa IA quando ativa */}
      {conv.ai_enabled && aiPaused && (
        <div className="px-4 py-1.5 text-xs flex items-center gap-2 border-t"
          style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', borderColor: 'var(--inunda-border)' }}>
          ⏸ IA pausada — você está no controle por {Math.ceil((aiPausedUntil - new Date()) / 60000)} min
        </div>
      )}

      {/* Input */}
      <form onSubmit={send} className="px-3 py-3 border-t flex items-end gap-2"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => onTyping(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Mensagem... (Shift+Enter quebra linha)"
          className="flex-1 bg-white/5 border rounded-2xl px-4 py-2 text-sm resize-none max-h-32 focus:outline-none focus:border-cyan-400"
          style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
        <button type="submit" disabled={!text.trim() || sending}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          style={{ background: 'var(--inunda-cyan)', color: 'var(--inunda-bg-deep)' }}>
          {sending ? '…' : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
          )}
        </button>
      </form>
    </div>
  );
}
