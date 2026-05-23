import { useEffect, useState } from 'react';
import api from '../services/api';
import useAuthStore from '../store/authStore';

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
      style={{
        color: active ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
        borderColor: active ? 'var(--inunda-cyan)' : 'transparent',
      }}>
      {children}
    </button>
  );
}

const inputCls = "w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400";

function CompaniesTab() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  function load() { api.get('/admin/companies').then((r) => setItems(r.data)).catch(() => {}); }
  useEffect(load, []);

  async function save() {
    try { await api.put(`/admin/companies/${editing.id}`, editing); setEditing(null); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }
  async function del(c) {
    if (!confirm(`DELETAR a empresa "${c.name}"? Isso vai apagar TUDO: conversas, contatos, mensagens, instâncias WhatsApp, config IA, etc. Irreversível.`)) return;
    if (!confirm(`Confirma: apagar permanentemente "${c.name}"?`)) return;
    try { await api.delete(`/admin/companies/${c.id}`); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro ao deletar'); }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {['Empresa', 'Slug', 'Status', 'Users', 'Conv', 'WA', 'Criada', 'Ações'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold border-b"
                  style={{ color: 'var(--inunda-text-faded)', borderColor: 'var(--inunda-border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-white/[0.03] border-b" style={{ borderColor: 'var(--inunda-border)', opacity: c.active ? 1 : 0.5 }}>
                <td className="px-3 py-2.5">
                  <p className="font-medium" style={{ color: 'var(--inunda-text)' }}>{c.name}</p>
                  {c.email && <p className="text-xs" style={{ color: 'var(--inunda-text-faded)' }}>{c.email}</p>}
                </td>
                <td className="px-3 py-2.5 font-mono-inunda text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{c.slug}</td>
                <td className="px-3 py-2.5">
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: c.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: c.active ? '#22c55e' : '#ef4444' }}>
                    {c.active ? 'ativa' : 'inativa'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{c.users_count}</td>
                <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{c.conversations_count}</td>
                <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{c.instances_count}</td>
                <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--inunda-text-faded)' }}>
                  {new Date(c.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => setEditing({ ...c })} className="text-xs px-2 py-1 mr-1" style={{ color: 'var(--inunda-cyan)' }}>Editar</button>
                  <button onClick={() => del(c)} className="text-xs px-2 py-1" style={{ color: '#ef4444' }}>Excluir</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10" style={{ color: 'var(--inunda-text-faded)' }}>Nenhuma empresa</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="rounded-2xl border shadow-2xl w-full max-w-md p-5 space-y-3"
            style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
            <h3 className="font-semibold" style={{ color: 'var(--inunda-text)' }}>Editar empresa</h3>
            <div>
              <label className="text-[10px] uppercase font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Nome</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className={inputCls} style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Email</label>
              <input value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className={inputCls} style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Max agentes</label>
              <input type="number" value={editing.max_agents ?? 10} onChange={(e) => setEditing({ ...editing, max_agents: parseInt(e.target.value || '10') })}
                className={inputCls} style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
              <span className="text-sm" style={{ color: 'var(--inunda-text)' }}>Empresa ativa</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="text-sm px-3 py-1.5" style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
              <button onClick={save} className="btn-primary text-sm px-4 py-1.5 rounded-lg">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuthStore();
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [editing, setEditing] = useState(null);

  function load() {
    Promise.all([api.get('/admin/users'), api.get('/admin/companies')])
      .then(([u, c]) => { setUsers(u.data); setCompanies(c.data); }).catch(() => {});
  }
  useEffect(load, []);

  async function save() {
    try {
      const payload = { name: editing.name, email: editing.email, active: editing.active, is_super_admin: editing.is_super_admin };
      if (editing.password) payload.password = editing.password;
      await api.put(`/admin/users/${editing.id}`, payload);
      setEditing(null); load();
    } catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }

  async function addMembership(u, company_id, role = 'agent') {
    try { await api.post(`/admin/users/${u.id}/memberships`, { company_id, role }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }
  async function removeMembership(u, company_id) {
    if (!confirm('Remover esta empresa do usuário?')) return;
    try { await api.delete(`/admin/users/${u.id}/memberships/${company_id}`); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }
  async function delUser(u) {
    if (u.id === me?.id) { alert('Você não pode deletar a si mesmo'); return; }
    if (!confirm(`Deletar usuário "${u.name}"? Memberships serão removidos.`)) return;
    try { await api.delete(`/admin/users/${u.id}`); load(); } catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="rounded-lg border p-3" style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)', opacity: u.active ? 1 : 0.6 }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold"
                style={{ background: u.is_super_admin ? 'rgba(168,85,247,0.18)' : 'var(--inunda-cyan-faint)', color: u.is_super_admin ? '#c084fc' : 'var(--inunda-cyan)' }}>
                {u.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm" style={{ color: 'var(--inunda-text)' }}>{u.name}</p>
                  {u.is_super_admin && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.18)', color: '#c084fc' }}>super admin</span>}
                  {!u.active && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}>inativo</span>}
                </div>
                <p className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>{u.email}</p>
              </div>
              <button onClick={() => setEditing({ ...u, password: '' })} className="text-xs px-2 py-1" style={{ color: 'var(--inunda-cyan)' }}>Editar</button>
              <button onClick={() => delUser(u)} className="text-xs px-2 py-1" style={{ color: '#ef4444' }}>Excluir</button>
            </div>

            <div className="mt-2.5 pt-2.5 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--inunda-border)' }}>
              <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>Empresas:</span>
              {(u.memberships || []).length === 0 && <span className="text-xs italic" style={{ color: 'var(--inunda-text-faded)' }}>nenhuma</span>}
              {(u.memberships || []).map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
                  {m.name}
                  <span className="opacity-60 text-[9px] uppercase">·{m.role}</span>
                  <button onClick={() => removeMembership(u, m.id)} className="opacity-60 hover:opacity-100 hover:text-red-400 ml-0.5">×</button>
                </span>
              ))}
              <select value="" onChange={(e) => { if (e.target.value) { addMembership(u, e.target.value); e.target.value = ''; } }}
                className="text-[11px] bg-transparent border rounded px-2 py-0.5"
                style={{ color: 'var(--inunda-cyan)', borderColor: 'var(--inunda-border)' }}>
                <option value="">+ adicionar empresa</option>
                {companies.filter((c) => !(u.memberships || []).some((m) => m.id === c.id)).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="rounded-2xl border shadow-2xl w-full max-w-md p-5 space-y-3"
            style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
            <h3 className="font-semibold" style={{ color: 'var(--inunda-text)' }}>Editar usuário</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Nome</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className={inputCls} style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              </div>
              <div>
                <label className="text-[10px] uppercase font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Email</label>
                <input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className={inputCls} style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase font-semibold block mb-1" style={{ color: 'var(--inunda-text-faded)' }}>Nova senha (vazio = manter)</label>
                <input type="password" value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  className={inputCls} style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
              <span className="text-sm" style={{ color: 'var(--inunda-text)' }}>Ativo</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!editing.is_super_admin} onChange={(e) => setEditing({ ...editing, is_super_admin: e.target.checked })} className="w-4 h-4 accent-purple-400" />
              <span className="text-sm" style={{ color: 'var(--inunda-text)' }}>Super Admin</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="text-sm px-3 py-1.5" style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
              <button onClick={save} className="btn-primary text-sm px-4 py-1.5 rounded-lg">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuperAdmin() {
  const [tab, setTab] = useState('companies');
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-5 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--inunda-text)' }}>Super Admin</h1>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.18)', color: '#c084fc' }}>
            controle global
          </span>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--inunda-text-muted)' }}>
          Gerencia todas as empresas e usuários da plataforma
        </p>

        <div className="flex gap-1 border-b mb-5" style={{ borderColor: 'var(--inunda-border)' }}>
          <Tab active={tab === 'companies'} onClick={() => setTab('companies')}>🏢 Empresas</Tab>
          <Tab active={tab === 'users'} onClick={() => setTab('users')}>👥 Usuários</Tab>
        </div>

        {tab === 'companies' && <CompaniesTab />}
        {tab === 'users' && <UsersTab />}
      </div>
    </div>
  );
}
