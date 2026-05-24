import { useEffect, useState } from 'react';
import api from '../services/api';
import MentionInput from './MentionInput';

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
  const [agents, setAgents] = useState([]);
  const [instances, setInstances] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [schedForm, setSchedForm] = useState(null); // { body, scheduled_for, instance_id, file, templateId }
  const [templates, setTemplates] = useState([]);
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
    api.get('/companies/agents').then((r) => setAgents(r.data)).catch(() => {});
    api.get('/instances').then((r) => setInstances(r.data)).catch(() => {});
    api.get(`/scheduled/contact/${conv.contact_id}`).then((r) => setScheduled(r.data)).catch(() => {});
    api.get('/templates').then((r) => setTemplates(r.data)).catch(() => {});
    api.get(`/tags/conversation/${conv.id}`)
      .then((r) => setConvTagIds(new Set((r.data || []).map((t) => t.id))))
      .catch(() => setConvTagIds(new Set()));
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

  async function changeAssigned(userId) {
    try {
      await api.post(`/conversations/${conv.id}/assign`, { user_id: userId || null });
      onConvUpdate?.({ assigned_to_user_id: userId || null });
    } catch {}
  }

  async function applyScheduledTemplate(templateId) {
    if (!templateId) { setSchedForm({ ...schedForm, templateId: '' }); return; }
    const tpl = templates.find((t) => String(t.id) === String(templateId));
    if (!tpl) return;
    let nextFile = schedForm.file;
    if (tpl.media_url) {
      try {
        const res = await fetch(tpl.media_url);
        const blob = await res.blob();
        nextFile = new File([blob], tpl.media_filename || 'arquivo', { type: tpl.media_mime || blob.type });
      } catch (e) { console.warn('falha ao baixar mídia do template', e); }
    }
    setSchedForm({
      ...schedForm,
      body: tpl.body || schedForm.body || '',
      file: nextFile,
      templateId,
    });
  }

  async function createScheduled() {
    if ((!schedForm?.body?.trim() && !schedForm?.file) || !schedForm?.scheduled_for || !schedForm?.instance_id) {
      alert('Preencha mensagem (ou anexe arquivo), data/hora e caixa'); return;
    }
    const localDate = new Date(schedForm.scheduled_for);
    if (localDate.getTime() <= Date.now()) {
      alert('Escolha um horário futuro'); return;
    }
    try {
      // Sempre multipart pra simplicidade (suporta arquivo opcional)
      const form = new FormData();
      form.append('body', schedForm.body || '');
      form.append('scheduled_for', localDate.toISOString());
      form.append('instance_id', schedForm.instance_id);
      if (schedForm.file) form.append('file', schedForm.file);
      const { data } = await api.post(`/scheduled/contact/${conv.contact_id}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setScheduled((p) => [data, ...p]);
      setSchedForm(null);
    } catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }
  async function cancelScheduled(id) {
    if (!confirm('Cancelar essa mensagem agendada?')) return;
    try { await api.delete(`/scheduled/${id}`); setScheduled((p) => p.map((s) => s.id === id ? { ...s, status: 'cancelled' } : s)); }
    catch {}
  }

  if (!conv) return null;
  const c = contact || {};
  const displayName = c.name || c.push_name || c.phone;

  return (
    <>
      {/* Backdrop só no mobile */}
      <div onClick={onClose}
        className="md:hidden fixed inset-0 bg-black/60 z-40" />
      <aside className="fixed md:static inset-y-0 right-0 z-50 w-full sm:w-96 md:w-80 flex-shrink-0 flex flex-col overflow-y-auto border-l"
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

      {/* Agente atribuído */}
      <Section title="Agente atribuído">
        <select value={conv.assigned_to_user_id || ''} onChange={(e) => changeAssigned(e.target.value || null)}
          className="w-full bg-white/5 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-cyan-400"
          style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
          <option value="">— Sem agente (todos veem) —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Section>

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
          <div className="flex gap-1.5 items-start">
            <div className="flex-1">
              <MentionInput as="textarea" rows={2} value={newNote} onChange={setNewNote}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }}
                placeholder="Nota... @ menciona agente"
                className="w-full bg-white/5 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-400 resize-none"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <button onClick={addNote} disabled={!newNote.trim()}
              className="text-xs px-2 py-1.5 rounded-lg disabled:opacity-40"
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

      {/* Mensagens agendadas */}
      <Section title="Mensagens agendadas"
        action={!schedForm && (
          <button onClick={() => setSchedForm({ body: '', scheduled_for: '', instance_id: instances[0]?.id || '' })}
            className="text-xs" style={{ color: 'var(--inunda-cyan)' }}>+ agendar</button>
        )}>
        {schedForm && (
          <div className="space-y-2 mb-3 p-2.5 rounded-lg"
            style={{ background: 'var(--inunda-bg-elevated)', border: '1px solid var(--inunda-border)' }}>
            <select value={schedForm.instance_id} onChange={(e) => setSchedForm({ ...schedForm, instance_id: e.target.value })}
              className="w-full bg-white/5 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
              <option value="">📦 Enviar pela caixa...</option>
              {instances.filter((i) => i.status === 'connected').map((i) => (
                <option key={i.id} value={i.id}>📦 {i.display_name || i.instance_name}</option>
              ))}
            </select>
            {templates.length > 0 && (
              <select value={schedForm.templateId || ''} onChange={(e) => applyScheduledTemplate(e.target.value)}
                className="w-full bg-white/5 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
                <option value="">⚡ Usar template (opcional)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.shortcut} {t.title ? `— ${t.title}` : ''}{t.media_filename ? ' 📎' : ''}
                  </option>
                ))}
              </select>
            )}
            <input type="datetime-local" value={schedForm.scheduled_for}
              onChange={(e) => setSchedForm({ ...schedForm, scheduled_for: e.target.value })}
              className="w-full bg-white/5 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            <textarea rows={3} value={schedForm.body} onChange={(e) => setSchedForm({ ...schedForm, body: e.target.value })}
              placeholder={schedForm.file ? 'Legenda (opcional)' : 'Mensagem que será enviada...'}
              className="w-full bg-white/5 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-400 resize-none"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            {/* Anexo opcional */}
            <div className="flex items-center gap-2">
              <label className="cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-md border"
                style={{ color: 'var(--inunda-cyan)', borderColor: 'var(--inunda-border)' }}>
                📎 {schedForm.file ? 'Trocar' : 'Anexar imagem/doc'}
                <input type="file" className="hidden"
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && f.size > 25 * 1024 * 1024) { alert('Máx 25MB'); return; }
                    setSchedForm({ ...schedForm, file: f || null });
                    e.target.value = '';
                  }} />
              </label>
              {schedForm.file && (
                <span className="text-[10px] truncate flex-1" style={{ color: 'var(--inunda-text-muted)' }}>
                  {schedForm.file.name} <button onClick={() => setSchedForm({ ...schedForm, file: null })} className="text-red-400 ml-1">×</button>
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <button onClick={createScheduled}
                disabled={(!schedForm.body.trim() && !schedForm.file) || !schedForm.scheduled_for || !schedForm.instance_id}
                className="btn-primary text-xs px-3 py-1 rounded-md flex-1 disabled:opacity-40">Agendar</button>
              <button onClick={() => setSchedForm(null)} className="text-xs px-2" style={{ color: 'var(--inunda-text-muted)' }}>×</button>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          {scheduled.length === 0 && !schedForm && (
            <p className="text-xs italic" style={{ color: 'var(--inunda-text-faded)' }}>Sem mensagens agendadas</p>
          )}
          {scheduled.map((s) => {
            const when = new Date(s.scheduled_for);
            const isPast = when < new Date() && s.status === 'pending';
            return (
              <div key={s.id} className="px-2 py-1.5 rounded-md text-xs flex items-start gap-2"
                style={{ background: 'var(--inunda-bg-elevated)', border: '1px solid var(--inunda-border)', opacity: s.status === 'cancelled' ? 0.5 : 1 }}>
                <div className="flex-1 min-w-0">
                  <p style={{ color: 'var(--inunda-text)' }} className="line-clamp-2">
                    {s.media_filename && <span className="opacity-70 mr-1">📎 {s.media_filename}</span>}
                    {s.body || (s.media_filename ? '' : '(vazio)')}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--inunda-text-faded)' }}>
                    📦 {s.instance_label || s.instance_name} · {when.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className="text-[9px] uppercase font-semibold px-1 py-0.5 rounded flex-shrink-0"
                  style={{
                    background: s.status === 'sent' ? 'rgba(34,197,94,0.15)' :
                                s.status === 'failed' ? 'rgba(239,68,68,0.15)' :
                                s.status === 'cancelled' ? 'rgba(255,255,255,0.05)' :
                                isPast ? 'rgba(251,191,36,0.15)' : 'rgba(0,212,232,0.15)',
                    color: s.status === 'sent' ? '#22c55e' :
                           s.status === 'failed' ? '#ef4444' :
                           s.status === 'cancelled' ? 'var(--inunda-text-faded)' :
                           isPast ? '#fbbf24' : 'var(--inunda-cyan)',
                  }}>
                  {s.status === 'pending' ? (isPast ? 'atrasado' : 'agendado') : s.status}
                </span>
                {s.status === 'pending' && (
                  <button onClick={() => cancelScheduled(s.id)} className="text-red-400 text-xs">×</button>
                )}
              </div>
            );
          })}
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
    </>
  );
}
