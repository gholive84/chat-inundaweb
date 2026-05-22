import { useEffect, useState } from 'react';
import api from '../services/api';

export default function Connect() {
  const [instances, setInstances] = useState([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(null);

  function load() {
    api.get('/instances').then((r) => setInstances(r.data)).catch(() => {});
  }
  useEffect(load, []);

  // Auto-poll QR enquanto houver instancia em 'connecting'
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
    setError(''); setCreating(true);
    try {
      const { data } = await api.post('/instances', { display_name: 'Principal' });
      setInstances((prev) => [data, ...prev]);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar instância (Evolution está rodando?)');
    } finally { setCreating(false); }
  }

  async function disconnect(id) {
    if (!confirm('Desconectar este WhatsApp?')) return;
    await api.post(`/instances/${id}/disconnect`).catch(() => {});
    load();
  }
  async function remove(id) {
    if (!confirm('Apagar essa instância? Vai precisar escanear QR de novo.')) return;
    await api.delete(`/instances/${id}`).catch(() => {});
    load();
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--inunda-text)' }}>WhatsApp</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--inunda-text-muted)' }}>
          Conecte o WhatsApp da sua empresa escaneando o QR code com o celular.
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm border"
            style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
            {error}
          </div>
        )}

        {instances.length === 0 && (
          <button onClick={createInstance} disabled={creating}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--inunda-cyan)', color: 'var(--inunda-bg-deep)' }}>
            {creating ? 'Criando…' : '+ Conectar WhatsApp'}
          </button>
        )}

        <div className="space-y-4 mt-4">
          {instances.map((inst) => (
            <div key={inst.id} className="rounded-2xl border p-5"
              style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--inunda-text)' }}>
                    {inst.display_name || inst.instance_name}
                  </p>
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
                <div className="flex flex-col items-center bg-white p-4 rounded-xl">
                  <img src={inst.qr_code} alt="QR" className="w-56 h-56" />
                  <p className="text-xs text-gray-600 mt-2 text-center">
                    Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho
                  </p>
                </div>
              )}
              {(inst.status === 'connecting' || inst.status === 'pending') && !inst.qr_code && (
                <p className="text-sm text-center py-6" style={{ color: 'var(--inunda-text-muted)' }}>
                  Aguardando QR code…
                </p>
              )}

              <div className="flex gap-2 mt-3">
                {inst.status === 'connected' && (
                  <button onClick={() => disconnect(inst.id)}
                    className="text-xs px-3 py-1.5 rounded-md hover:bg-white/[0.06]"
                    style={{ color: '#fbbf24' }}>
                    Desconectar
                  </button>
                )}
                <button onClick={() => remove(inst.id)}
                  className="text-xs px-3 py-1.5 rounded-md hover:bg-white/[0.06]"
                  style={{ color: '#ef4444' }}>
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
