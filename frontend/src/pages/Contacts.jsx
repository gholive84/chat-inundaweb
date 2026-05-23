import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function Contacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [stages, setStages] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [editing, setEditing] = useState(null);

  function loadAll() {
    Promise.all([
      api.get('/contacts'),
      api.get('/conversations?status=all'),
      api.get('/crm/stages'),
    ]).then(([c, cv, s]) => { setContacts(c.data); setConversations(cv.data); setStages(s.data); }).catch(() => {});
  }
  useEffect(loadAll, []);

  const convByContact = useMemo(() => {
    const m = new Map();
    conversations.forEach((cv) => m.set(cv.contact_id, cv));
    return m;
  }, [conversations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filterStage && c.crm_stage !== filterStage) return false;
      if (!q) return true;
      const text = `${c.name || ''} ${c.push_name || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [contacts, search, filterStage]);

  async function saveContact() {
    if (!editing) return;
    try {
      await api.put(`/contacts/${editing.id}`, {
        name: editing.name, email: editing.email, notes: editing.notes, crm_stage: editing.crm_stage,
      });
      setContacts((prev) => prev.map((c) => c.id === editing.id ? { ...c, ...editing } : c));
      setEditing(null);
    } catch (err) { alert(err.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b flex items-center justify-between flex-wrap gap-3"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--inunda-text)' }}>Contatos</h1>
          <p className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
            {filtered.length} de {contacts.length}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Nome, telefone, email..."
            className="bg-white/5 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)', minWidth: 220 }} />
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}
            className="bg-white/5 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-cyan-400"
            style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
            <option value="">Todos estágios</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--inunda-bg-surface)' }}>
            <tr>
              {['Contato', 'Telefone', 'Email', 'Estágio', 'Última msg', 'Ações'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-semibold border-b"
                  style={{ color: 'var(--inunda-text-faded)', borderColor: 'var(--inunda-border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const cv = convByContact.get(c.id);
              const name = c.name || c.push_name || c.phone;
              const stage = stages.find((s) => s.id === c.crm_stage);
              return (
                <tr key={c.id} className="hover:bg-white/[0.03] border-b" style={{ borderColor: 'var(--inunda-border)' }}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {c.profile_pic_url ? (
                        <img src={c.profile_pic_url} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                          style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
                          {name?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <span style={{ color: 'var(--inunda-text)' }}>{name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono-inunda text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{c.phone}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{c.email || '—'}</td>
                  <td className="px-4 py-2.5">
                    {stage ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'rgba(0,212,232,0.12)', color: 'var(--inunda-cyan)' }}>{stage.label}</span>
                    ) : <span className="text-xs" style={{ color: 'var(--inunda-text-faded)' }}>—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
                    {cv?.last_message_at ? new Date(cv.last_message_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {cv && (
                      <button onClick={() => navigate(`/app/chat/${cv.id}`)}
                        className="text-xs px-2 py-1 rounded-md mr-1 hover:bg-cyan-400/10"
                        style={{ color: 'var(--inunda-cyan)' }}>Abrir chat</button>
                    )}
                    <button onClick={() => setEditing({ ...c })}
                      className="text-xs px-2 py-1 rounded-md hover:bg-white/[0.06]"
                      style={{ color: 'var(--inunda-text-muted)' }}>Editar</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12" style={{ color: 'var(--inunda-text-faded)' }}>
                Nenhum contato {contacts.length > 0 ? 'com esses filtros' : 'ainda — eles aparecem aqui quando você recebe a primeira mensagem'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="rounded-2xl border shadow-2xl w-full max-w-md p-5"
            style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--inunda-text)' }}>Editar contato</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Nome</label>
                <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                  style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Email</label>
                <input type="email" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                  style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Estágio CRM</label>
                <select value={editing.crm_stage || ''} onChange={(e) => setEditing({ ...editing, crm_stage: e.target.value || null })}
                  className="w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                  style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
                  <option value="">— Nenhum —</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Notas</label>
                <textarea rows={3} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  className="w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400 resize-none"
                  style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="text-sm px-3 py-1.5" style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
              <button onClick={saveContact} className="btn-primary text-sm px-4 py-1.5 rounded-lg">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
