import { useEffect, useState } from 'react';
import api from '../services/api';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => {
    api.get('/ai/config').then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  async function save() {
    setError(''); setOkMsg(''); setSaving(true);
    try {
      await api.put('/ai/config', config);
      setOkMsg('Salvo');
      setTimeout(() => setOkMsg(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar');
    } finally { setSaving(false); }
  }

  if (!config) return <div className="p-8 text-sm" style={{ color: 'var(--inunda-text-muted)' }}>Carregando…</div>;

  const set = (patch) => setConfig({ ...config, ...patch });

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--inunda-text)' }}>Configurações de IA</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--inunda-text-muted)' }}>
          Configure o atendente automático para responder mensagens quando nenhum agente humano estiver disponível.
        </p>

        {error && <div className="mb-4 px-4 py-3 rounded-xl text-sm border" style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>{error}</div>}
        {okMsg && <div className="mb-4 px-4 py-3 rounded-xl text-sm border" style={{ color: '#86efac', borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)' }}>{okMsg}</div>}

        <div className="rounded-2xl border p-5 space-y-4"
          style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={!!config.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
            <span className="text-sm font-medium" style={{ color: 'var(--inunda-text)' }}>Habilitar resposta automática por IA</span>
          </label>

          <div>
            <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>Provider</label>
            <select value={config.provider} onChange={(e) => set({ provider: e.target.value })}
              className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }}>
              <option value="none">— Nenhum —</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>
              API Key {config.has_key && <span className="text-cyan-400 normal-case">(já configurada — deixe vazio pra manter)</span>}
            </label>
            <input type="password" placeholder="sk-..." value={config.api_key || ''}
              onChange={(e) => set({ api_key: e.target.value })}
              className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm font-mono-inunda focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>Modelo</label>
            <input placeholder={config.provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini'}
              value={config.model || ''} onChange={(e) => set({ model: e.target.value })}
              className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm font-mono-inunda focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>System prompt</label>
            <textarea rows={4} placeholder="Você é uma atendente da [empresa] que…"
              value={config.system_prompt || ''} onChange={(e) => set({ system_prompt: e.target.value })}
              className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm resize-y focus:outline-none focus:border-cyan-400"
              style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>Pausa ao agente digitar (s)</label>
              <input type="number" min={0} value={config.pause_seconds ?? 600}
                onChange={(e) => set({ pause_seconds: parseInt(e.target.value || '0') })}
                className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>Max tokens</label>
              <input type="number" min={64} value={config.max_tokens ?? 1024}
                onChange={(e) => set({ max_tokens: parseInt(e.target.value || '1024') })}
                className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>Temperature</label>
              <input type="number" step="0.1" min={0} max={2} value={config.temperature ?? 0.7}
                onChange={(e) => set({ temperature: parseFloat(e.target.value || '0.7') })}
                className="w-full bg-white/5 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-cyan-400"
                style={{ color: 'var(--inunda-text)', borderColor: 'var(--inunda-border)' }} />
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--inunda-cyan)', color: 'var(--inunda-bg-deep)' }}>
            {saving ? 'Salvando…' : 'Salvar configurações'}
          </button>
        </div>
      </div>
    </div>
  );
}
