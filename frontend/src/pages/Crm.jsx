import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import api from '../services/api';

const STAGE_COLORS = {
  blue: '#3b82f6', yellow: '#facc15', purple: '#a855f7',
  green: '#22c55e', red: '#ef4444', gray: '#6b7280',
  indigo: '#6366f1', teal: '#14b8a6',
};

export default function Crm() {
  const navigate = useNavigate();
  const [stages, setStages] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [editingStages, setEditingStages] = useState(false);
  const [newStage, setNewStage] = useState({ id: '', label: '', color: 'blue' });

  function loadAll() {
    Promise.all([
      api.get('/crm/stages'),
      api.get('/contacts'),
      api.get('/conversations?status=all'),
    ]).then(([s, c, cv]) => {
      setStages(s.data); setContacts(c.data); setConversations(cv.data);
    }).catch(() => {});
  }
  useEffect(loadAll, []);

  // Mapa contact_id → conversation
  const convByContact = useMemo(() => {
    const m = new Map();
    conversations.forEach((cv) => m.set(cv.contact_id, cv));
    return m;
  }, [conversations]);

  // Agrupa contatos por stage. Contatos sem stage vão em "sem_estagio"
  const byStage = useMemo(() => {
    const m = new Map();
    m.set('__none__', []);
    stages.forEach((s) => m.set(s.id, []));
    contacts.forEach((c) => {
      const k = c.crm_stage && m.has(c.crm_stage) ? c.crm_stage : '__none__';
      m.get(k).push(c);
    });
    // Ordena cada coluna por crm_order
    for (const k of m.keys()) m.get(k).sort((a, b) => (a.crm_order ?? 0) - (b.crm_order ?? 0));
    return m;
  }, [stages, contacts]);

  async function onDragEnd({ draggableId, destination, source }) {
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    const contactId = parseInt(draggableId);
    const stage = destination.droppableId === '__none__' ? null : destination.droppableId;
    // Otimista
    setContacts((prev) => prev.map((c) => c.id === contactId ? { ...c, crm_stage: stage, crm_order: destination.index } : c));
    try {
      await api.put(`/crm/contacts/${contactId}/stage`, { stage, order: destination.index });
    } catch { loadAll(); }
  }

  const [editingStage, setEditingStage] = useState(null);

  async function createStage() {
    if (!newStage.id || !newStage.label) return;
    try {
      await api.post('/crm/stages', { ...newStage, position: stages.length });
      setNewStage({ id: '', label: '', color: 'blue' });
      const r = await api.get('/crm/stages'); setStages(r.data);
    } catch (err) { alert(err.response?.data?.error || 'Erro'); }
  }
  async function saveStage() {
    if (!editingStage?.label) return;
    try {
      await api.put(`/crm/stages/${editingStage.id}`, {
        label: editingStage.label, color: editingStage.color, position: editingStage.position,
      });
      setEditingStage(null);
      const r = await api.get('/crm/stages'); setStages(r.data);
    } catch (err) { alert(err.response?.data?.error || 'Erro'); }
  }
  async function deleteStage(id) {
    if (!confirm('Excluir estágio? Contatos nele ficarão sem estágio.')) return;
    try { await api.delete(`/crm/stages/${id}`); loadAll(); } catch {}
  }

  const cols = [
    ...stages.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    { id: '__none__', label: 'Sem estágio', color: 'gray' },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--inunda-text)' }}>CRM</h1>
          <p className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
            {contacts.length} contato{contacts.length !== 1 ? 's' : ''} · arraste pra mudar de estágio
          </p>
        </div>
        <button onClick={() => setEditingStages((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: editingStages ? 'var(--inunda-cyan)' : 'var(--inunda-cyan-faint)',
                   color: editingStages ? 'var(--inunda-bg-deep)' : 'var(--inunda-cyan)' }}>
          {editingStages ? 'Concluir' : '⚙ Estágios'}
        </button>
      </div>

      {editingStages && (
        <div className="p-4 border-b" style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>ID</label>
              <input value={newStage.id} onChange={(e) => setNewStage({ ...newStage, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                placeholder="ex: aguardando"
                className="bg-white/5 border rounded px-2 py-1 text-sm font-mono-inunda focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Label</label>
              <input value={newStage.label} onChange={(e) => setNewStage({ ...newStage, label: e.target.value })}
                placeholder="Aguardando contato"
                className="bg-white/5 border rounded px-2 py-1 text-sm focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Cor</label>
              <select value={newStage.color} onChange={(e) => setNewStage({ ...newStage, color: e.target.value })}
                className="bg-white/5 border rounded px-2 py-1 text-sm focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
                {Object.keys(STAGE_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button onClick={createStage} disabled={!newStage.id || !newStage.label}
              className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
              style={{ background: 'var(--inunda-cyan)', color: 'var(--inunda-bg-deep)' }}>
              + Adicionar estágio
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stages.map((s) => {
              const isEditing = editingStage?.id === s.id;
              return (
                <span key={s.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                  style={{ borderColor: STAGE_COLORS[s.color] || s.color, color: STAGE_COLORS[s.color] || s.color }}>
                  {isEditing ? (
                    <>
                      <input autoFocus value={editingStage.label}
                        onChange={(e) => setEditingStage({ ...editingStage, label: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveStage(); if (e.key === 'Escape') setEditingStage(null); }}
                        className="bg-transparent border-0 outline-0 w-28 text-xs"
                        style={{ color: 'var(--inunda-text)' }} />
                      <select value={editingStage.color} onChange={(e) => setEditingStage({ ...editingStage, color: e.target.value })}
                        className="bg-transparent border-0 text-[10px]" style={{ color: 'var(--inunda-text)' }}>
                        {Object.keys(STAGE_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button onClick={saveStage} className="text-green-400" title="Salvar">✓</button>
                      <button onClick={() => setEditingStage(null)} className="opacity-60" title="Cancelar">×</button>
                    </>
                  ) : (
                    <>
                      {s.label}
                      <button onClick={() => setEditingStage({ ...s })} className="opacity-60 hover:opacity-100" title="Editar">✏️</button>
                      <button onClick={() => deleteStage(s.id)} className="opacity-60 hover:opacity-100 hover:text-red-400" title="Excluir">×</button>
                    </>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 h-full">
            {cols.map((col) => {
              const list = byStage.get(col.id) || [];
              const color = STAGE_COLORS[col.color] || col.color || '#6b7280';
              return (
                <div key={col.id} className="flex-shrink-0 w-72 flex flex-col rounded-xl h-full"
                  style={{ background: 'var(--inunda-bg-surface)', border: '1px solid var(--inunda-border)' }}>
                  <div className="px-3 py-2.5 border-b flex items-center justify-between flex-shrink-0"
                    style={{ borderColor: 'var(--inunda-border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      <p className="text-sm font-semibold" style={{ color: 'var(--inunda-text)' }}>{col.label}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--inunda-text-muted)' }}>
                      {list.length}
                    </span>
                  </div>
                  <Droppable droppableId={col.id}>
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps}
                        className={`flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] transition-colors ${snapshot.isDraggingOver ? 'bg-white/[0.03]' : ''}`}>
                        {list.map((c, index) => {
                          const cv = convByContact.get(c.id);
                          const name = c.name || c.push_name || c.phone;
                          return (
                            <Draggable key={c.id} draggableId={String(c.id)} index={index}>
                              {(provided, snapshot) => (
                                <div ref={provided.innerRef} {...provided.draggableProps}
                                  className={`rounded-lg transition-shadow ${snapshot.isDragging ? 'shadow-lg ring-1 ring-cyan-400' : 'hover:bg-white/[0.04]'}`}
                                  style={{
                                    background: 'var(--inunda-bg-deep)',
                                    border: '1px solid var(--inunda-border)',
                                    ...provided.draggableProps.style, // ← preserva transform durante drag
                                  }}>
                                  {/* Drag handle visivel: cabecalho do card */}
                                  <div {...provided.dragHandleProps}
                                    className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing">
                                    {c.profile_pic_url ? (
                                      <img src={c.profile_pic_url} className="w-7 h-7 rounded-full object-cover" />
                                    ) : (
                                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                                        style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
                                        {name?.[0]?.toUpperCase() || '?'}
                                      </div>
                                    )}
                                    <p className="text-sm font-medium truncate flex-1" style={{ color: 'var(--inunda-text)' }}>{name}</p>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-30 flex-shrink-0"
                                      style={{ color: 'var(--inunda-text-faded)' }}>
                                      <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                                      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                                      <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                                    </svg>
                                  </div>
                                  {/* Area clicavel (separada do handle): abre a conversa */}
                                  <button onClick={() => cv && navigate(`/app/chat/${cv.id}`)}
                                    disabled={!cv}
                                    className="w-full text-left px-3 pb-2.5 disabled:opacity-50">
                                    <p className="text-[11px] font-mono-inunda" style={{ color: 'var(--inunda-text-faded)' }}>{c.phone}</p>
                                    {cv?.last_message_preview && (
                                      <p className="text-xs truncate mt-1" style={{ color: 'var(--inunda-text-muted)' }}>
                                        {cv.last_message_preview}
                                      </p>
                                    )}
                                    {!cv && (
                                      <p className="text-[10px] italic mt-1" style={{ color: 'var(--inunda-text-faded)' }}>
                                        sem conversa ainda
                                      </p>
                                    )}
                                  </button>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                        {list.length === 0 && (
                          <div className="text-center text-xs py-6 italic" style={{ color: 'var(--inunda-text-faded)' }}>
                            vazio
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>
    </div>
  );
}
