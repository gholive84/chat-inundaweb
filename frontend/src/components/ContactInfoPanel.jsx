import { useEffect, useState } from 'react';
import api from '../services/api';

function Section({ title, action, children }) {
  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="inunda-label">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function ContactInfoPanel({ conv, onConvUpdate, onClose }) {
  const [contact, setContact] = useState(null);
  const [notes, setNotes] = useState([]);
  const [tags, setTags] = useState([]);
  const [convTagIds, setConvTagIds] = useState(new Set());
  const [stages, setStages] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    if (!conv?.id) return;
    api.get(`/contacts/${conv.contact_id}`).then((r) => {
      setContact(r.data); setNameValue(r.data.name || ''); setEmailValue(r.data.email || '');
    }).catch(() => {});
    api.get(`/notes/conversation/${conv.id}`).then((r) => setNotes(r.data)).catch(() => {});
    api.get('/tags').then((r) => setTags(r.data)).catch(() => {});
    api.get('/crm/stages').then((r) => setStages(r.data)).catch(() => {});
    // TODO: pegar tags da conversa — backend ainda nao expoe (placeholder)
    setConvTagIds(new Set());
  }, [conv?.id, conv?.contact_id]);

  async function saveContact(patch) {
    setSavingContact(true);
    try {
      await api.put(`/contacts/${contact.id}`, { ...contact, ...patch });
      const next = { ...contact, ...patch };
      setContact(next);
      onConvUpdate?.(next);
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao salvar');
    } finally { setSavingContact(false); }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    try {
      const { data } = await api.post(`/notes/conversation/${conv.id}`, { body: newNote });
      setNotes((p) => [data, ...p]);
      setNewNote('');
    } catch {}
  }
  async function deleteNote(id) {
    if (!confirm('Excluir nota?')) return;
    try { await api.delete(`/notes/${id}`); setNotes((p) => p.filter((n) => n.id !== id)); } catch {}
  }

  async function createTagAndAttach() {
    const label = newTag.trim();
    if (!label) return;
    try {
      // tenta achar existente, senao cria
      let existing = tags.find((t) => t.label.toLowerCase() === label.toLowerCase());
      if (!existing) {
        const { data } = await api.post('/tags', { label });
        existing = data;
        setTags((p) => [...p, existing]);
      }
      await api.post(`/tags/conversation/${conv.id}/${existing.id}`);
      setConvTagIds((p) => new Set([...p, existing.id]));
      setNewTag('');
    } catch (err) { alert(err.response?.data?.error || 'Erro'); }
  }
  async function detachTag(tagId) {
    try {
      await api.delete(`/tags/conversation/${conv.id}/${tagId}`);
      setConvTagIds((p) => { const s = new Set(p); s.delete(tagId); return s; });
    } catch {}
  }

  async function changeStage(stage) {
    if (!contact) return;
    try {
      await api.put(`/crm/contacts/${contact.id}/stage`, { stage });
      setContact((p) => ({ ...p, crm_stage: stage }));
    } catch {}
  }

  if (!conv) return null;
  const c = contact || {};
  const displayName = c.name || c.push_name || c.phone;

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col overflow-y-auto border-l"
      style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>

      <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--inunda-text)' }}>Informações</p>
        {onClose && (
          <button onClick={onClose} className="text-white/40 hover:text-white p-1 rounded">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {/* Avatar + nome */}
      <div className="flex flex-col items-center p-5 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
        {c.profile_pic_url ? (
          <img src={c.profile_pic_url} className="w-20 h-20 rounded-full object-cover" />
        ) : (
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-semibold"
            style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
            {displayName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="mt-3 text-center w-full">
          {editingName ? (
            <input autoFocus value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={() => { setEditingName(false); if (nameValue !== (c.name || '')) saveContact({ name: nameValue }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setNameValue(c.name || ''); setEditingName(false); } }}
              className="w-full bg-white/5 border rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
          ) : (
            <button onClick={() => setEditingName(true)} title="Editar"
              className="text-base font-semibold hover:text-cyan-300 transition-colors"
              style={{ color: 'var(--inunda-text)' }}>
              {c.name || c.push_name || <em className="opacity-60">(sem nome)</em>}
            </button>
          )}
          <p className="text-xs font-mono-inunda mt-0.5" style={{ color: 'var(--inunda-text-faded)' }}>{c.phone}</p>
        </div>
      </div>

      {/* CRM stage */}
      {stages.length > 0 && (
        <Section title="Estágio CRM">
          <select value={c.crm_stage || ''} onChange={(e) => changeStage(e.target.value || null)}
            className="w-full bg-white/5 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
            <option value="">— Sem estágio —</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Section>
      )}

      {/* Email */}
      <Section title="Email">
        {editingEmail ? (
          <input autoFocus type="email" value={emailValue}
            onChange={(e) => setEmailValue(e.target.value)}
            onBlur={() => { setEditingEmail(false); if (emailValue !== (c.email || '')) saveContact({ email: emailValue }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEmailValue(c.email || ''); setEditingEmail(false); } }}
            placeholder="email@exemplo.com"
            className="w-full bg-white/5 border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
        ) : (
          <button onClick={() => setEditingEmail(true)}
            className="text-sm hover:text-cyan-300"
            style={{ color: c.email ? 'var(--inunda-text)' : 'var(--inunda-text-faded)' }}>
            {c.email || '+ adicionar email'}
          </button>
        )}
      </Section>

      {/* Notas internas */}
      <Section title="Notas internas">
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <input value={newNote} onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
              placeholder="Adicionar nota..."
              className="flex-1 bg-white/5 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            <button onClick={addNote} disabled={!newNote.trim()}
              className="text-xs px-2 rounded-lg disabled:opacity-40"
              style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
              +
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="text-xs italic" style={{ color: 'var(--inunda-text-faded)' }}>Sem notas</p>
          ) : notes.map((n) => (
            <div key={n.id} className="group rounded-lg px-2.5 py-2"
              style={{ background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs whitespace-pre-wrap flex-1" style={{ color: '#fde68a' }}>{n.body}</p>
                <button onClick={() => deleteNote(n.id)}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-red-400 text-xs">×</button>
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'rgba(251, 191, 36, 0.5)' }}>
                {n.author_name} · {new Date(n.created_at).toLocaleString('pt-BR')}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Tags */}
      <Section title="Tags">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.filter((t) => convTagIds.has(t.id)).map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: t.color, color: 'white' }}>
              {t.label}
              <button onClick={() => detachTag(t.id)} className="opacity-80 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createTagAndAttach(); }}
            placeholder="Nova tag…"
            className="flex-1 bg-white/5 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
          <button onClick={createTagAndAttach} disabled={!newTag.trim()}
            className="text-xs px-2 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>+</button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.filter((t) => !convTagIds.has(t.id)).map((t) => (
              <button key={t.id} onClick={async () => {
                try { await api.post(`/tags/conversation/${conv.id}/${t.id}`); setConvTagIds((p) => new Set([...p, t.id])); }
                catch {}
              }}
                className="text-[10px] px-1.5 py-0.5 rounded-full border opacity-70 hover:opacity-100"
                style={{ borderColor: t.color, color: t.color, background: 'transparent' }}>
                + {t.label}
              </button>
            ))}
          </div>
        )}
      </Section>
    </aside>
  );
}
