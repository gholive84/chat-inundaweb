import { useEffect, useRef, useState } from 'react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import api from '../services/api';
import useSocketStore from '../store/socketStore';
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
  if (url && m.type === 'video') {
    return <video src={url} controls className="rounded-md max-w-full max-h-64" />;
  }
  if (url && m.type === 'audio') {
    return <AudioPlayer src={url} fromMe={fromMe} />;
  }
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

  // Fallback: placeholder (sem url ainda — fica esperando S3 subir)
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

function Bubble({ m }) {
  const fromMe = !!m.from_me;
  const isAI = m.author_type === 'ai';
  const isMedia = m.type && m.type !== 'text';
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
        {isMedia && <MediaRender m={m} fromMe={fromMe} />}
        {m.body && (
          <p className={`whitespace-pre-wrap leading-snug ${isMedia ? 'mt-1.5' : ''}`}>{m.body}</p>
        )}
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mediaRecRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const socket = useSocketStore((s) => s.socket) || useSocketStore.getState().connect();
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
      const r = await api.get(`/messages/${conversationId}`);
      setMessages(r.data);
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
    setRecording(false);
    setRecSeconds(0);
  }

  function cancelRecording() {
    if (mediaRecRef.current) {
      mediaRecRef.current.onstop = null;
      mediaRecRef.current.stop();
      mediaRecRef.current.stream?.getTracks().forEach((t) => t.stop());
    }
    clearInterval(recTimerRef.current);
    setRecording(false);
    setRecSeconds(0);
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

      {/* Recording bar */}
      {recording && (
        <div className="flex items-center gap-3 px-3 py-2.5 border-t"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'var(--inunda-border)' }}>
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-sm font-mono-inunda text-red-400 font-medium">{fmtSec(recSeconds)}</span>
          <span className="text-xs flex-1" style={{ color: 'var(--inunda-text-muted)' }}>Gravando áudio…</span>
          <button type="button" onClick={cancelRecording}
            className="text-xs px-3 py-1 rounded-md hover:bg-white/5"
            style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
          <button type="button" onClick={stopRecording}
            className="text-xs px-3 py-1 rounded-md flex items-center gap-1.5"
            style={{ background: '#22c55e', color: '#fff' }}>
            <span className="w-2 h-2 bg-white rounded-sm" /> Enviar
          </button>
        </div>
      )}

      {/* Input — estilo WhatsApp: pill + botão grande verde */}
      <form onSubmit={send} className="px-2 py-2 border-t flex items-end gap-2 relative"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        {/* Pill que envolve todos os controles do input */}
        <div className="flex-1 flex items-end gap-1 rounded-full px-1.5 py-1"
          style={{ background: 'var(--inunda-bg-elevated)', minHeight: 48 }}>
          {/* Emoji */}
          <button type="button" data-emoji-toggle
            onClick={() => setEmojiOpen((v) => !v)}
            title="Emoji"
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 hover:bg-white/[0.08] transition-colors"
            style={{ color: 'var(--inunda-text-muted)' }}>
            😀
          </button>
          {emojiOpen && (
            <div className="emoji-picker-wrap absolute bottom-16 left-2 z-30 shadow-2xl rounded-lg overflow-hidden">
              <EmojiPicker
                onEmojiClick={(e) => { insertEmoji(e.emoji); }}
                theme={Theme.DARK}
                emojiStyle={EmojiStyle.NATIVE}
                width={320}
                height={400}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
              />
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => onTyping(e.target.value)}
            onKeyDown={handleKey}
            onPaste={onPaste}
            placeholder="Mensagem"
            className="flex-1 bg-transparent border-0 px-1 py-2 text-sm resize-none max-h-32 focus:outline-none leading-snug self-center"
            style={{ color: 'var(--inunda-text)' }} />

          {/* Anexar arquivo */}
          <button type="button" onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Anexar arquivo"
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

          {/* Camera */}
          <button type="button" onClick={() => cameraInputRef.current?.click()}
            title="Câmera"
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

        {/* Botão verde redondo: send (se tem texto) OU mic (se vazio) */}
        {text.trim() ? (
          <button type="submit" disabled={sending}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 shadow-md transition-transform active:scale-95"
            style={{ background: '#22c55e', color: '#fff' }}>
            {sending ? '…' : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
            )}
          </button>
        ) : (
          <button type="button" onClick={startRecording}
            title="Gravar áudio"
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 shadow-md transition-transform active:scale-95"
            style={{ background: '#22c55e', color: '#fff' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
