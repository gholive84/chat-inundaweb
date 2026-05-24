import { useEffect, useRef, useState, useCallback } from 'react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import api from '../services/api';
import useSocketStore from '../store/socketStore';
import useAuthStore from '../store/authStore';
import useAutoScroll from '../hooks/useAutoScroll';
import AudioPlayer from './AudioPlayer';

function formatTime(d) {
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function authorLabel(m) {
  if (m.author_type === 'ai') return 'IA';
  if (m.author_type === 'agent') return m.author_name || 'Agente';
  return '';
}

const TYPE_LABEL = {
  image: { icon: '📷', label: 'Imagem' },
  audio: { icon: '🎤', label: 'Áudio' },
  video: { icon: '🎥', label: 'Vídeo' },
  document: { icon: '📎', label: 'Documento' },
  sticker: { icon: '🌟', label: 'Sticker' },
  location: { icon: '📍', label: 'Localização' },
};

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function MediaRender({ m, fromMe }) {
  const t = TYPE_LABEL[m.type] || { icon: '📄', label: m.type };
  const url = m.media_url;
  if (url && (m.type === 'image' || m.type === 'sticker')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt={t.label} className="rounded-md max-w-full max-h-64 object-cover" />
      </a>
    );
  }
  if (url && m.type === 'video') return <video src={url} controls className="rounded-md max-w-full max-h-64" />;
  if (url && m.type === 'audio') return <AudioPlayer src={url} fromMe={fromMe} />;
  if (url && m.type === 'document') {
    return (
      <a href={url} target="_blank" rel="noreferrer"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:underline ${fromMe ? 'bg-black/20' : 'bg-white/[0.04]'}`}>
        <span className="text-base">📎</span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{m.media_filename || 'Documento'}</p>
          {m.media_mime && <p className="text-[10px] opacity-70">{m.media_mime}</p>}
        </div>
      </a>
    );
  }
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${fromMe ? 'bg-black/20' : 'bg-white/[0.04]'}`}>
      <span className="text-base">{t.icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{t.label}</p>
        {(m.media_filename || m.media_mime) && (
          <p className="text-[10px] opacity-70 truncate">{m.media_filename || m.media_mime}</p>
        )}
        {!url && <p className="text-[10px] opacity-50 italic">processando…</p>}
      </div>
    </div>
  );
}

// Bolha de citação (quote) renderizada acima do conteudo da msg
function QuoteBlock({ m, onClick }) {
  if (!m.quoted_body && !m.quoted_msg_id) return null;
  return (
    <button
      onClick={() => onClick?.(m.quoted_msg_id)}
      className="block w-full text-left mb-1 px-2 py-1 rounded border-l-2 bg-black/15 hover:bg-black/25 transition-colors"
      style={{ borderColor: m.quoted_from_me ? '#22c55e' : '#06b6d4' }}>
      <p className="text-[10px] uppercase font-semibold opacity-70">
        {m.quoted_from_me ? 'Você' : 'Contato'}
      </p>
      <p className="text-xs opacity-90 line-clamp-2 whitespace-pre-wrap">{m.quoted_body}</p>
    </button>
  );
}

// Linha de reações sob a bolha
function ReactionsRow({ reactions, onReact }) {
  if (!reactions?.length) return null;
  // agrupa por emoji
  const groups = {};
  reactions.forEach((r) => {
    groups[r.emoji] = groups[r.emoji] || { count: 0, mine: false, names: [] };
    groups[r.emoji].count++;
    if (r.by_type === 'user') groups[r.emoji].names.push(r.by_user_name || 'Atendente');
  });
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(groups).map(([emoji, g]) => (
        <button key={emoji} onClick={() => onReact?.(emoji)}
          title={g.names.join(', ') || 'Cliente'}
          className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-0.5 hover:scale-110 transition-transform"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span>{emoji}</span>
          {g.count > 1 && <span className="text-[10px] opacity-80">{g.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Highlight de termo de busca no body
function HighlightedText({ text, term }) {
  if (!term || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(t, i);
    if (idx === -1) { parts.push(<span key={i}>{text.slice(i)}</span>); break; }
    if (idx > i) parts.push(<span key={i}>{text.slice(i, idx)}</span>);
    parts.push(<mark key={idx} className="bg-yellow-300 text-black rounded px-0.5">{text.slice(idx, idx + term.length)}</mark>);
    i = idx + term.length;
  }
  return <>{parts}</>;
}

function Bubble({ m, isActive, searchTerm, onReply, onReact, onEdit, onDelete, onForward, onQuoteClick }) {
  const fromMe = !!m.from_me;
  const isAI = m.author_type === 'ai';
  const isDeleted = !!m.deleted_at;
  const isMedia = m.type && m.type !== 'text';
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactPickerOpen, setReactPickerOpen] = useState(false);

  // Fecha menu/picker quando clica fora
  useEffect(() => {
    if (!menuOpen && !reactPickerOpen) return;
    const onDown = (e) => {
      if (!e.target.closest('[data-msg-menu]')) { setMenuOpen(false); setReactPickerOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, reactPickerOpen]);

  const ageMs = Date.now() - new Date(m.created_at).getTime();
  const canEdit = fromMe && !isDeleted && m.type === 'text' && ageMs < 15 * 60 * 1000;

  // Cores das bolhas — texto fica white quando o bg é colorido escuro (emerald/purple).
  // Pra bolha do contato (cinza claro no light, cinza escuro no dark) usamos var(--inunda-text)
  // que se adapta sozinho ao tema. Resolve o bug do "branco no branco" no tema light.
  const bubbleBg = fromMe
    ? (isAI ? 'bg-purple-600/90' : 'bg-emerald-600')
    : 'bubble-incoming';
  const textColor = fromMe ? '#ffffff' : 'var(--inunda-text)';
  return (
    <div id={`msg-${m.id}`}
      className={`group flex ${fromMe ? 'justify-end' : 'justify-start'} ${isActive ? 'ring-2 ring-yellow-400/60 rounded-lg -mx-1 px-1' : ''}`}>
      <div className="relative max-w-[70%]" data-msg-menu>
        <div className={`px-3 py-2 rounded-lg shadow-sm text-sm ${bubbleBg} ${isDeleted ? 'italic opacity-60' : ''}`}
          style={{ wordBreak: 'break-word', color: textColor }}>
          {fromMe && isAI && (
            <p className="text-[10px] uppercase tracking-wider opacity-80 font-semibold mb-0.5">🤖 IA</p>
          )}
          {fromMe && m.author_type === 'agent' && (
            <p className="text-[10px] uppercase tracking-wider opacity-80 font-semibold mb-0.5">{authorLabel(m)}</p>
          )}
          <QuoteBlock m={m} onClick={onQuoteClick} />
          {!isDeleted && isMedia && <MediaRender m={m} fromMe={fromMe} />}
          {m.body && (
            <p className={`whitespace-pre-wrap leading-snug ${isMedia ? 'mt-1.5' : ''}`}>
              <HighlightedText text={m.body} term={searchTerm} />
            </p>
          )}
          <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
            {m.edited_at && !isDeleted && <span className="text-[9px] opacity-70 italic">editada</span>}
            <span className="text-[10px]" style={{ opacity: 0.7 }}>{formatTime(m.created_at)}</span>
            {fromMe && !isDeleted && m.status === 'sent' && <span className="text-[10px]" style={{ opacity: 0.7 }}>✓</span>}
            {fromMe && !isDeleted && m.status === 'delivered' && <span className="text-[10px]" style={{ opacity: 0.7 }}>✓✓</span>}
            {fromMe && !isDeleted && m.status === 'read' && <span className="text-[10px]" style={{ color: '#7dd3fc' }}>✓✓</span>}
            {fromMe && m.status === 'failed' && <span className="text-[10px] text-red-300" title={m.error || 'falha'}>⚠</span>}
            {fromMe && m.status === 'pending' && <span className="text-[10px]" style={{ opacity: 0.5 }}>⏳</span>}
          </div>
        </div>
        <ReactionsRow reactions={m.reactions} onReact={onReact ? (e) => onReact(m.id, e) : null} />

        {/* Menu de ações (hover desktop / click mobile) */}
        {!isDeleted && (
          <div className={`absolute ${fromMe ? '-left-9' : '-right-9'} top-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
            <button onClick={() => setMenuOpen((v) => !v)}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/80">
              ⋯
            </button>
            {menuOpen && (
              <div className={`absolute top-8 ${fromMe ? 'left-0' : 'right-0'} z-30 min-w-[160px] rounded-lg shadow-xl border text-xs overflow-hidden`}
                style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
                <button onClick={() => { setMenuOpen(false); onReply?.(m); }}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.06] flex items-center gap-2"
                  style={{ color: 'var(--inunda-text)' }}>↩ Responder</button>
                <button onClick={() => { setMenuOpen(false); setReactPickerOpen(true); }}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.06] flex items-center gap-2"
                  style={{ color: 'var(--inunda-text)' }}>😀 Reagir</button>
                <button onClick={() => { setMenuOpen(false); onForward?.(m); }}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.06] flex items-center gap-2"
                  style={{ color: 'var(--inunda-text)' }}>↗ Encaminhar</button>
                {canEdit && (
                  <button onClick={() => { setMenuOpen(false); onEdit?.(m); }}
                    className="w-full text-left px-3 py-2 hover:bg-white/[0.06] flex items-center gap-2"
                    style={{ color: 'var(--inunda-text)' }}>✎ Editar</button>
                )}
                {fromMe && (
                  <button onClick={() => { setMenuOpen(false); onDelete?.(m); }}
                    className="w-full text-left px-3 py-2 hover:bg-white/[0.06] flex items-center gap-2"
                    style={{ color: '#fca5a5' }}>🗑 Apagar pra todos</button>
                )}
              </div>
            )}
            {reactPickerOpen && (
              <div className={`absolute top-8 ${fromMe ? 'left-0' : 'right-0'} z-30 rounded-full shadow-xl border flex gap-0.5 px-2 py-1`}
                style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
                {REACTION_EMOJIS.map((emoji) => (
                  <button key={emoji} onClick={() => { setReactPickerOpen(false); onReact?.(m.id, emoji); }}
                    className="w-8 h-8 rounded-full hover:bg-white/10 text-lg">{emoji}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Modal de encaminhar — escolhe destinos
function ForwardModal({ msg, onClose, onForward }) {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api.get('/conversations?status=all&limit=200').then((r) => setConversations(r.data)).catch(() => {});
  }, []);
  const filtered = conversations.filter((c) =>
    !search || (c.contact_name || c.push_name || c.phone || '').toLowerCase().includes(search.toLowerCase())
  );
  function toggle(cid) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  }
  async function go() {
    if (!selected.size) return;
    setSending(true);
    try {
      await onForward(Array.from(selected));
      onClose();
    } finally { setSending(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl border shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <div className="p-4 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
          <p className="font-semibold mb-2" style={{ color: 'var(--inunda-text)' }}>↗ Encaminhar mensagem</p>
          <p className="text-xs mb-2 line-clamp-2" style={{ color: 'var(--inunda-text-muted)' }}>
            {msg.body || `[${msg.type}]`}
          </p>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 buscar contato..."
            className="w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.map((c) => (
            <button key={c.id} onClick={() => toggle(c.id)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/[0.04] text-left">
              <input type="checkbox" checked={selected.has(c.id)} readOnly className="w-4 h-4 accent-cyan-400" />
              {c.profile_pic_url ? (
                <img src={c.profile_pic_url} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                  style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
                  {(c.contact_name || c.phone || '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--inunda-text)' }}>{c.contact_name || c.push_name || c.phone}</p>
                {c.instance_label && <p className="text-[10px]" style={{ color: 'var(--inunda-text-faded)' }}>📦 {c.instance_label}</p>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center text-sm py-8" style={{ color: 'var(--inunda-text-faded)' }}>Nenhum contato</p>}
        </div>
        <div className="p-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--inunda-border)' }}>
          <button onClick={onClose} className="text-sm px-3 py-1.5" style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
          <button onClick={go} disabled={!selected.size || sending}
            className="text-sm px-4 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: '#22c55e', color: '#fff' }}>
            {sending ? 'Enviando…' : `Encaminhar (${selected.size})`}
          </button>
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  // Novos states pra features adicionais
  const [replyTo, setReplyTo] = useState(null);   // msg sendo respondida
  const [editing, setEditing] = useState(null);   // msg sendo editada
  const [forwardMsg, setForwardMsg] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchHits, setSearchHits] = useState([]); // array de message ids
  const [searchIdx, setSearchIdx] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplFilter, setTplFilter] = useState('');

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mediaRecRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const socket = useSocketStore((s) => s.socket) || useSocketStore.getState().connect();
  const { user } = useAuthStore();
  const typingTimer = useRef(null);
  const bottomRef = useAutoScroll([messages.length], conversationId);

  // Close emoji on click outside
  useEffect(() => {
    if (!emojiOpen) return;
    const onClick = (e) => {
      if (e.target.closest('.emoji-picker-wrap') || e.target.closest('[data-emoji-toggle]')) return;
      setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [emojiOpen]);

  // Carrega templates uma vez
  useEffect(() => {
    api.get('/templates').then((r) => setTemplates(r.data)).catch(() => {});
  }, []);

  // Carrega conversa + mensagens; junta na sala via socket
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    setReplyTo(null); setEditing(null); setSearchOpen(false); setSearchTerm('');
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

    const refetch = () => api.get(`/messages/${conversationId}`).then((r) => setMessages(r.data)).catch(() => {});
    const onNew = ({ conversationId: id }) => { if (id === conversationId) refetch(); };
    const onStatus = ({ messageId, status }) => {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, status } : m));
    };
    const onReaction = ({ messageId }) => refetch();
    const onEdited = ({ messageId }) => refetch();
    const onDeleted = ({ messageId }) => refetch();
    socket?.on('message:new', onNew);
    socket?.on('message:status', onStatus);
    socket?.on('message:reaction', onReaction);
    socket?.on('message:edited', onEdited);
    socket?.on('message:deleted', onDeleted);
    return () => {
      cancelled = true;
      socket?.emit('leave_conversation', { conversationId });
      socket?.off('message:new', onNew);
      socket?.off('message:status', onStatus);
      socket?.off('message:reaction', onReaction);
      socket?.off('message:edited', onEdited);
      socket?.off('message:deleted', onDeleted);
    };
  }, [conversationId, socket]);

  // ── Busca dentro da conversa ──
  useEffect(() => {
    if (!searchOpen || !searchTerm.trim()) { setSearchHits([]); setSearchIdx(0); return; }
    const t = setTimeout(() => {
      api.get(`/messages/${conversationId}/search`, { params: { q: searchTerm } })
        .then((r) => {
          const ids = r.data.map((x) => x.id);
          setSearchHits(ids);
          setSearchIdx(0);
          if (ids.length) scrollToMessage(ids[0]);
        }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm, searchOpen, conversationId]);

  function scrollToMessage(id) {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function nextHit(delta) {
    if (!searchHits.length) return;
    const next = (searchIdx + delta + searchHits.length) % searchHits.length;
    setSearchIdx(next); scrollToMessage(searchHits[next]);
  }

  // ── Typing → pausa IA ──
  function onTyping(value) {
    setText(value);
    // Autocomplete de template: se começa com / e nao tem espaço ainda
    const trimmed = value.trim();
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      setTplFilter(trimmed);
      setTplOpen(true);
    } else {
      setTplOpen(false);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
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
      if (editing) {
        await api.patch(`/messages/${editing.id}`, { body: text });
        setEditing(null);
      } else {
        await api.post(`/messages/${conversationId}`, {
          body: text,
          reply_to: replyTo?.id || undefined,
        });
        setReplyTo(null);
      }
      setText('');
    } catch (err) {
      alert(err.response?.data?.error || 'Falha ao enviar');
    } finally { setSending(false); }
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      if (tplOpen) { setTplOpen(false); return; }
      if (editing) { setEditing(null); setText(''); return; }
      if (replyTo) { setReplyTo(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
  }

  function insertEmoji(emoji) {
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? text.length;
    const next = text.slice(0, pos) + emoji + text.slice(pos);
    setText(next);
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(pos + emoji.length, pos + emoji.length); }, 0);
  }

  async function sendFile(file, caption = '') {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('Arquivo > 25MB'); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (caption) form.append('caption', caption);
      await api.post(`/messages/${conversationId}/media`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Falha ao enviar arquivo');
    } finally { setUploading(false); }
  }

  function onPaste(e) {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) {
        const ext = blob.type.split('/')[1] || 'png';
        const named = new File([blob], `paste-${Date.now()}.${ext}`, { type: blob.type });
        sendFile(named, text);
        setText('');
      }
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
      const rec = new MediaRecorder(stream, { mimeType: mime });
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) audioChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mime });
        const ext = mime.includes('mp4') ? 'm4a' : 'ogg';
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: mime });
        sendFile(file);
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (e) {
      alert('Permita acesso ao microfone pra gravar áudio');
    }
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    clearInterval(recTimerRef.current);
    setRecording(false); setRecSeconds(0);
  }
  function cancelRecording() {
    if (mediaRecRef.current) {
      mediaRecRef.current.onstop = null;
      mediaRecRef.current.stop();
      mediaRecRef.current.stream?.getTracks().forEach((t) => t.stop());
    }
    clearInterval(recTimerRef.current);
    setRecording(false); setRecSeconds(0);
    audioChunksRef.current = [];
  }
  function fmtSec(s) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
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
  async function toggleUrgent() {
    if (!conv) return;
    try {
      await api.post(`/conversations/${conversationId}/urgent`, { urgent: !conv.is_urgent });
      setConv((p) => ({ ...p, is_urgent: !p.is_urgent }));
    } catch {}
  }

  // ── Callbacks da bolha ──
  const onReply = useCallback((m) => {
    setEditing(null);
    setReplyTo(m);
    textareaRef.current?.focus();
  }, []);
  const onEdit = useCallback((m) => {
    setReplyTo(null);
    setEditing(m);
    setText(m.body || '');
    textareaRef.current?.focus();
  }, []);
  const onReact = useCallback(async (msgId, emoji) => {
    try { await api.post(`/messages/reactions/${msgId}`, { emoji }); } catch {}
  }, []);
  const onDelete = useCallback(async (m) => {
    if (!confirm('Apagar esta mensagem pra todos? (irreversível)')) return;
    try { await api.delete(`/messages/${m.id}`); } catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }, []);
  const onForwardClick = useCallback((m) => setForwardMsg(m), []);
  async function doForward(conversationIds) {
    await api.post(`/messages/${forwardMsg.id}/forward`, { conversation_ids: conversationIds });
  }
  const onQuoteClick = useCallback((id) => { if (id) scrollToMessage(id); }, []);

  // Templates: aplica selecionado
  async function applyTemplate(tpl) {
    setTplOpen(false);
    if (tpl.media_url) {
      // Reenvia a mídia + caption (refazendo fetch direto)
      try {
        setUploading(true);
        const res = await fetch(tpl.media_url);
        const blob = await res.blob();
        const file = new File([blob], tpl.media_filename || 'arquivo', { type: tpl.media_mime || blob.type });
        await sendFile(file, tpl.body || '');
        setText('');
      } catch (e) {
        // Fallback: envia só texto
        setText(tpl.body || '');
      } finally { setUploading(false); }
    } else {
      setText(tpl.body || '');
      textareaRef.current?.focus();
    }
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
  const activeMsgId = searchHits[searchIdx];

  // Filtra templates pelo atalho digitado
  const filteredTpls = templates.filter((t) =>
    t.shortcut.toLowerCase().startsWith(tplFilter.toLowerCase())
  ).slice(0, 8);

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full" style={{ background: 'var(--inunda-bg-deep)' }}>
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
          <p className="text-xs font-mono-inunda hidden md:block" style={{ color: 'var(--inunda-text-faded)' }}>{conv.phone}</p>
        </div>
        {/* 🔍 buscar dentro da conversa */}
        <button onClick={() => setSearchOpen((v) => !v)}
          title="Buscar dentro da conversa"
          className="p-2 rounded-lg"
          style={{ color: searchOpen ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button onClick={toggleUrgent}
          title={conv.is_urgent ? 'Remover urgência' : 'Marcar como urgente'}
          className="p-2 rounded-lg transition-colors"
          style={{
            background: conv.is_urgent ? 'rgba(239,68,68,0.18)' : 'transparent',
            color: conv.is_urgent ? '#ef4444' : 'var(--inunda-text-muted)',
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={conv.is_urgent ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M12 2L1 21h22L12 2z"/><line x1="12" y1="9" x2="12" y2="13" stroke={conv.is_urgent ? '#fff' : 'currentColor'}/><circle cx="12" cy="17" r="0.5" fill={conv.is_urgent ? '#fff' : 'currentColor'}/>
          </svg>
        </button>
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
          title={conv.ai_enabled ? (aiPaused ? 'IA pausada (agente ativo)' : 'IA ativa') : 'IA desativada'}
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
            className="w-10 h-10 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-colors"
            style={{
              background: infoOpen ? 'var(--inunda-cyan)' : 'var(--inunda-cyan-faint)',
              color: infoOpen ? 'var(--inunda-bg-deep)' : 'var(--inunda-cyan)',
            }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </button>
        )}
      </div>

      {/* Barra de busca */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b"
          style={{ background: 'var(--inunda-bg-elevated)', borderColor: 'var(--inunda-border)' }}>
          <input autoFocus value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar nesta conversa..."
            className="flex-1 bg-transparent border-0 text-sm focus:outline-none"
            style={{ color: 'var(--inunda-text)' }} />
          <span className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
            {searchHits.length ? `${searchIdx + 1} de ${searchHits.length}` : (searchTerm ? '0 resultados' : '')}
          </span>
          <button onClick={() => nextHit(-1)} disabled={!searchHits.length} className="px-2 disabled:opacity-30" style={{ color: 'var(--inunda-text-muted)' }}>↑</button>
          <button onClick={() => nextHit(1)} disabled={!searchHits.length} className="px-2 disabled:opacity-30" style={{ color: 'var(--inunda-text-muted)' }}>↓</button>
          <button onClick={() => { setSearchOpen(false); setSearchTerm(''); }} className="px-2" style={{ color: 'var(--inunda-text-muted)' }}>×</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ background: 'var(--inunda-bg-deep)' }}>
        {messages.length === 0 && (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--inunda-text-faded)' }}>Sem mensagens ainda</div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m}
            isActive={activeMsgId === m.id}
            searchTerm={searchTerm}
            onReply={onReply}
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
            onForward={onForwardClick}
            onQuoteClick={onQuoteClick}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Banner pausa IA */}
      {conv.ai_enabled && aiPaused && (
        <div className="px-4 py-1.5 text-xs flex items-center gap-2 border-t"
          style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', borderColor: 'var(--inunda-border)' }}>
          ⏸ IA pausada — você está no controle por {Math.ceil((aiPausedUntil - new Date()) / 60000)} min
        </div>
      )}

      {/* Reply preview acima do input */}
      {replyTo && (
        <div className="px-3 py-1.5 border-t flex items-start gap-2"
          style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-elevated)' }}>
          <div className="border-l-2 pl-2 flex-1 min-w-0" style={{ borderColor: replyTo.from_me ? '#22c55e' : '#06b6d4' }}>
            <p className="text-[10px] uppercase font-semibold opacity-70" style={{ color: 'var(--inunda-text-faded)' }}>
              ↩ Respondendo a {replyTo.from_me ? 'você' : 'contato'}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--inunda-text-muted)' }}>
              {replyTo.body || `[${replyTo.type}]`}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-white/50 hover:text-white text-lg leading-none">×</button>
        </div>
      )}
      {/* Edit preview */}
      {editing && (
        <div className="px-3 py-1.5 border-t flex items-start gap-2"
          style={{ borderColor: 'var(--inunda-border)', background: 'rgba(168,85,247,0.08)' }}>
          <div className="border-l-2 pl-2 flex-1 min-w-0" style={{ borderColor: '#c084fc' }}>
            <p className="text-[10px] uppercase font-semibold" style={{ color: '#c084fc' }}>✎ Editando mensagem</p>
            <p className="text-xs truncate" style={{ color: 'var(--inunda-text-muted)' }}>Esc pra cancelar</p>
          </div>
          <button onClick={() => { setEditing(null); setText(''); }} className="text-white/50 hover:text-white text-lg leading-none">×</button>
        </div>
      )}

      {/* Recording bar */}
      {recording && (
        <div className="flex items-center gap-3 px-3 py-2.5 border-t"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'var(--inunda-border)' }}>
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-sm font-mono-inunda text-red-400 font-medium">{fmtSec(recSeconds)}</span>
          <span className="text-xs flex-1" style={{ color: 'var(--inunda-text-muted)' }}>Gravando áudio…</span>
          <button type="button" onClick={cancelRecording}
            className="text-xs px-3 py-1 rounded-md hover:bg-white/5" style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
          <button type="button" onClick={stopRecording}
            className="text-xs px-3 py-1 rounded-md flex items-center gap-1.5" style={{ background: '#22c55e', color: '#fff' }}>
            <span className="w-2 h-2 bg-white rounded-sm" /> Enviar
          </button>
        </div>
      )}

      {/* Template autocomplete */}
      {tplOpen && filteredTpls.length > 0 && (
        <div className="absolute bottom-16 left-2 right-2 md:left-16 md:right-16 lg:left-1/4 lg:right-1/4 z-40 rounded-lg shadow-2xl border max-h-60 overflow-y-auto"
          style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
          {filteredTpls.map((t) => (
            <button key={t.id} onClick={() => applyTemplate(t)}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.06] flex items-start gap-2 border-b last:border-b-0"
              style={{ borderColor: 'var(--inunda-border)' }}>
              <span className="font-mono-inunda text-xs font-semibold" style={{ color: 'var(--inunda-cyan)' }}>{t.shortcut}</span>
              <div className="flex-1 min-w-0">
                {t.title && <p className="text-sm" style={{ color: 'var(--inunda-text)' }}>{t.title}</p>}
                <p className="text-xs truncate" style={{ color: 'var(--inunda-text-muted)' }}>
                  {t.media_filename ? `📎 ${t.media_filename} ` : ''}{t.body || ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={send} className="px-2 py-2 border-t flex items-end gap-2 relative"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <div className="flex-1 flex items-end gap-1 rounded-full px-1.5 py-1"
          style={{ background: 'var(--inunda-bg-elevated)', minHeight: 48 }}>
          <button type="button" data-emoji-toggle
            onClick={() => setEmojiOpen((v) => !v)} title="Emoji"
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 hover:bg-white/[0.08] transition-colors"
            style={{ color: 'var(--inunda-text-muted)' }}>😀</button>
          {emojiOpen && (
            <div className="emoji-picker-wrap absolute bottom-16 left-2 z-30 shadow-2xl rounded-lg overflow-hidden">
              <EmojiPicker onEmojiClick={(e) => insertEmoji(e.emoji)} theme={Theme.DARK} emojiStyle={EmojiStyle.NATIVE}
                width={320} height={400} skinTonesDisabled previewConfig={{ showPreview: false }} />
            </div>
          )}

          <textarea ref={textareaRef} rows={1} value={text}
            onChange={(e) => onTyping(e.target.value)}
            onKeyDown={handleKey} onPaste={onPaste}
            placeholder={editing ? 'Editar mensagem...' : (replyTo ? 'Resposta...' : 'Mensagem (use /atalho pra templates)')}
            className="flex-1 bg-transparent border-0 px-1 py-2 text-sm resize-none max-h-32 focus:outline-none leading-snug self-center"
            style={{ color: 'var(--inunda-text)' }} />

          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Anexar arquivo"
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-white/[0.08] transition-colors disabled:opacity-40"
            style={{ color: 'var(--inunda-text-muted)' }}>
            {uploading ? '⏳' : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            )}
          </button>
          <input ref={fileInputRef} type="file" className="hidden"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f, text); e.target.value = ''; setText(''); }} />

          <button type="button" onClick={() => cameraInputRef.current?.click()} title="Câmera"
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-white/[0.08] transition-colors"
            style={{ color: 'var(--inunda-text-muted)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
          <input ref={cameraInputRef} type="file" className="hidden" accept="image/*" capture="environment"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f, text); e.target.value = ''; setText(''); }} />
        </div>

        {text.trim() ? (
          <button type="submit" disabled={sending}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 shadow-md transition-transform active:scale-95"
            style={{ background: editing ? '#a855f7' : '#22c55e', color: '#fff' }}>
            {sending ? '…' : (editing
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
            )}
          </button>
        ) : (
          <button type="button" onClick={startRecording} title="Gravar áudio"
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 shadow-md transition-transform active:scale-95"
            style={{ background: '#22c55e', color: '#fff' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
        )}
      </form>

      {forwardMsg && <ForwardModal msg={forwardMsg} onClose={() => setForwardMsg(null)} onForward={doForward} />}
    </div>
  );
}
