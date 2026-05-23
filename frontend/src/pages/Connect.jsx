import { useEffect, useState } from 'react';
import api from '../services/api';
import useAuthStore from '../store/authStore';

export default function Connect() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';
  const [instances, setInstances] = useState([]);
  const [agents, setAgents] = useState([]);
  const [limits, setLimits] = useState({ max: 1, used: 0, remaining: 1 });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [tempName, setTempName] = useState('');

  function load() {
    api.get('/instances').then((r) => setInstances(r.data)).catch(() => {});
    api.get('/instances/limits').then((r) => setLimits(r.data)).catch(() => {});
  }
  useEffect(load, []);
  useEffect(() => { api.get('/companies/agents').then((r) => setAgents(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    const connecting = instances.find((i) => i.status === 'connecting' || i.status === 'pending');
    if (!connecting) { if (polling) { clearInterval(polling); setPolling(null); } return; }
    if (polling) return;
    const id = setInterval(async () => {
      try {
        const { data } = await api.get(`/instances/${connecting.id}/qr`);
        setInstances((prev) => prev.map((i) => i.id === data.id ? { ...i, ...data } : i));
        if (data.status === 'connected') load();
      } catch {}
    }, 4000);
    setPolling(id);
    return () => clearInterval(id);
  }, [instances]);

  async function createInstance() {
    if (!newName.trim()) { setError('Dê um nome pra caixa (ex: Comercial)'); return; }
    setError(''); setCreating(true);
    try {
      const { data } = await api.post('/instances', { display_name: newName });
      setInstances((prev) => [data, ...prev]);
      setNewName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar instância');
    } finally { setCreating(false); }
  }

  async function disconnect(id) {
    if (!confirm('Desconectar este WhatsApp?')) return;
    await api.post(`/instances/${id}/disconnect`).catch(() => {});
    load();
  }
  async function remove(id) {
    if (!confirm('Remover essa caixa? Conversas vão ficar órfãs (sem instância).')) return;
    await api.delete(`/instances/${id}`).catch(() => {});
    load();
  }

  async function saveName(id) {
    try { await api.put(`/instances/${id}`, { display_name: tempName }); setEditingName(null); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }

  async function addAgent(instId, userId) {
    try { await api.post(`/instances/${instId}/agents`, { user_id: userId }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }
  async function removeAgent(instId, userId) {
    try { await api.delete(`/instances/${instId}/agents/${userId}`); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--inunda-text)' }}>Caixas WhatsApp</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--inunda-text-muted)' }}>
          Conecte múltiplos números (ex: Comercial, Financeiro). Cada caixa pode ter atendentes próprios.
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm border"
            style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
            {error}
          </div>
        )}

        {/* Criar nova caixa */}
        {isOwner && (
          <div className="rounded-xl border p-4 mb-5"
            style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>
                + Nova caixa
              </p>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-mono-inunda"
                style={{
                  background: limits.remaining === 0 ? 'rgba(249,115,22,0.15)' : 'var(--inunda-cyan-faint)',
                  color: limits.remaining === 0 ? '#fb923c' : 'var(--inunda-cyan)',
                }}>
                {limits.used}/{limits.max} caixas
              </span>
            </div>
            {limits.remaining === 0 ? (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ color: '#fb923c', background: 'rgba(249,115,22,0.08)' }}>
                Limite de caixas atingido para sua empresa. Para conectar mais números, contate o administrador da plataforma.
              </p>
            ) : (
              <div className="flex gap-2">
                <input value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && limits.remaining > 0) createInstance(); }}
                  placeholder="Ex: Comercial, Financeiro, Suporte..."
                  className="flex-1 bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                  style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
                <button onClick={createInstance} disabled={creating || !newName.trim()}
                  className="btn-primary px-4 py-2 rounded-lg text-sm">
                  {creating ? '…' : '+ Conectar'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {instances.map((inst) => (
            <div key={inst.id} className="rounded-2xl border p-5"
              style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  {editingName === inst.id ? (
                    <div className="flex gap-1.5 items-center">
                      <input autoFocus value={tempName} onChange={(e) => setTempName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveName(inst.id); if (e.key === 'Escape') setEditingName(null); }}
                        className="bg-white/5 border rounded px-2 py-1 text-sm focus:outline-none focus:border-cyan-400"
                        style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
                      <button onClick={() => saveName(inst.id)} className="text-xs px-2" style={{ color: 'var(--inunda-cyan)' }}>OK</button>
                    </div>
                  ) : (
                    <p className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--inunda-text)' }}>
                      {inst.display_name || '(sem nome)'}
                      {isOwner && (
                        <button onClick={() => { setEditingName(inst.id); setTempName(inst.display_name || ''); }}
                          title="Renomear" className="text-xs opacity-50 hover:opacity-100">✏️</button>
                      )}
                    </p>
                  )}
                  <p className="text-xs font-mono-inunda mt-0.5" style={{ color: 'var(--inunda-text-faded)' }}>
                    {inst.instance_name}
                  </p>
                </div>
                <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-1 rounded-full"
                  style={{
                    background: inst.status === 'connected' ? 'rgba(34,197,94,0.15)' :
                                inst.status === 'connecting' ? 'rgba(0,212,232,0.15)' :
                                'rgba(255,255,255,0.06)',
                    color: inst.status === 'connected' ? '#22c55e' :
                           inst.status === 'connecting' ? 'var(--inunda-cyan)' :
                           'var(--inunda-text-muted)',
                  }}>
                  {inst.status}
                </span>
              </div>

              {(inst.status === 'connecting' || inst.status === 'pending') && inst.qr_code && (
                <div className="flex flex-col items-center bg-white p-4 rounded-xl mb-3">
                  <img src={inst.qr_code} alt="QR" className="w-56 h-56" />
                  <p className="text-xs text-gray-600 mt-2 text-center">
                    Abra o WhatsApp no celular → Aparelhos conectados → Conectar
                  </p>
                </div>
              )}

              {/* Agentes atribuidos */}
              {inst.status === 'connected' && isOwner && (
                <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--inunda-border)' }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--inunda-text-faded)' }}>
                    Atendentes desta caixa <span className="normal-case opacity-60">(vazio = owners veem todas)</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(inst.agents || []).map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
                        style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
                        {a.name}
                        <button onClick={() => removeAgent(inst.id, a.id)} className="opacity-70 hover:opacity-100">×</button>
                      </span>
                    ))}
                    <select value="" onChange={(e) => { if (e.target.value) { addAgent(inst.id, e.target.value); e.target.value = ''; } }}
                      className="text-xs border border-dashed bg-transparent rounded px-2 py-0.5"
                      style={{ color: 'var(--inunda-text-muted)', borderColor: 'var(--inunda-border)' }}>
                      <option value="">+ atendente</option>
                      {agents.filter((a) => a.active && !(inst.agents || []).some((x) => x.id === a.id)).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-3">
                {inst.status === 'connected' && isOwner && (
                  <button onClick={() => disconnect(inst.id)}
                    className="text-xs px-3 py-1.5 rounded-md hover:bg-white/[0.06]" style={{ color: '#fbbf24' }}>
                    Desconectar
                  </button>
                )}
                {isOwner && (
                  <button onClick={() => remove(inst.id)}
                    className="text-xs px-3 py-1.5 rounded-md hover:bg-white/[0.06]" style={{ color: '#ef4444' }}>
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}

          {instances.length === 0 && (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--inunda-text-faded)' }}>
              Nenhuma caixa conectada ainda. {isOwner ? 'Crie uma acima.' : 'Peça pro owner conectar.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
