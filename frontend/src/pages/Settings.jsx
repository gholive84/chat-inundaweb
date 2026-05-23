import { useEffect, useState } from 'react';
import api from '../services/api';
import useAuthStore from '../store/authStore';
import { getPermission, requestPermission, notify } from '../services/notifications';

const TABS = [
  { id: 'app',        label: 'App',         icon: '📱' },
  { id: 'ai',         label: 'IA por Caixa', icon: '🤖' },
  { id: 'agents',     label: 'Atendentes',  icon: '👥' },
];

function Notice({ type = 'info', children }) {
  const styles = {
    info:    { bg: 'rgba(0,212,232,0.08)',  border: 'rgba(0,212,232,0.35)', color: '#7dd3fc' },
    error:   { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.35)', color: '#fca5a5' },
    success: { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.35)', color: '#86efac' },
  }[type];
  return (
    <div className="px-3 py-2 rounded-lg text-xs border mb-3"
      style={{ background: styles.bg, borderColor: styles.border, color: styles.color }}>{children}</div>
  );
}

// ─── Empresa: assinatura de msg ───────────────────────────────────
function CompanySettings() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState('');
  useEffect(() => { api.get('/companies/me').then((r) => setCfg(r.data.company)).catch(() => {}); }, []);
  if (!cfg) return null;
  const set = (p) => setCfg({ ...cfg, ...p });
  async function save() {
    setSaving(true);
    try {
      await api.put('/companies/me', cfg);
      setOk('Salvo'); setTimeout(() => setOk(''), 2000);
    } catch {} finally { setSaving(false); }
  }
  const fmt = cfg.signature_format || 'bold';
  const preview = fmt === 'brackets' ? '[Gustavo]' : fmt === 'plain' ? 'Gustavo:' : '*Gustavo*';
  return (
    <div className="rounded-xl border p-5 space-y-3"
      style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">✍️</span>
        <div className="flex-1">
          <p className="font-semibold" style={{ color: 'var(--inunda-text)' }}>Assinar mensagens</p>
          <p className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
            Adiciona o nome do atendente automaticamente acima de cada mensagem enviada.
            Útil quando vários atendentes respondem do mesmo número.
          </p>
        </div>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={!!cfg.sign_messages} onChange={(e) => set({ sign_messages: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
        <span className="text-sm" style={{ color: 'var(--inunda-text)' }}>Habilitar assinatura</span>
      </label>
      {cfg.sign_messages && (
        <>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1.5" style={{ color: 'var(--inunda-text-faded)' }}>Formato</label>
            <select value={fmt} onChange={(e) => set({ signature_format: e.target.value })} className={inputCls}>
              <option value="bold">*Nome* (negrito WhatsApp)</option>
              <option value="brackets">[Nome]</option>
              <option value="plain">Nome:</option>
            </select>
          </div>
          <div className="rounded-lg p-3 text-xs font-mono-inunda" style={{ background: 'rgba(0,212,232,0.08)', color: 'var(--inunda-text)' }}>
            <p className="opacity-60 text-[10px] mb-1">Preview:</p>
            <p>{preview}</p>
            <p>Olá! Como posso ajudar?</p>
          </div>
        </>
      )}
      {ok && <Notice type="success">{ok}</Notice>}
      <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 rounded-lg text-sm">
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}

// ─── Tab App (PWA + notificações) ─────────────────────────────────
function TabApp() {
  const [installable, setInstallable] = useState(!!window.__pwaInstallPrompt);
  const [installed, setInstalled] = useState(
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
  );
  const [permission, setPermission] = useState(getPermission());
  const [isIOS] = useState(typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent));
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); window.__pwaInstallPrompt = e; setInstallable(true); };
    const onInstalled = () => { setInstalled(true); setInstallable(false); window.__pwaInstallPrompt = null; };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    const p = window.__pwaInstallPrompt;
    if (!p) return;
    p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome === 'accepted') { setInstalled(true); setInstallable(false); window.__pwaInstallPrompt = null; }
  }

  async function askPermission() {
    const r = await requestPermission();
    setPermission(r);
    if (r === 'granted') {
      notify({ title: 'Notificações ativadas', body: 'Você vai receber alertas quando chegar mensagem nova.', tag: 'test' });
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Empresa: assinatura */}
      <CompanySettings />

      {/* PWA Install */}
      <div className="rounded-xl border p-5"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <div className="flex items-start gap-3 mb-3">
          <img src="/icone-chat.png" className="h-10 w-10 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold" style={{ color: 'var(--inunda-text)' }}>Instalar como aplicativo</p>
            <p className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
              Use o Chat Inunda como app nativo no seu desktop ou celular — sem barra do navegador, ícone na home, abre direto.
            </p>
          </div>
        </div>

        {installed ? (
          <p className="text-sm flex items-center gap-2" style={{ color: '#22c55e' }}>
            <span>✓</span> App já instalado neste dispositivo
          </p>
        ) : installable ? (
          <button onClick={install} className="btn-primary px-4 py-2 rounded-lg text-sm">
            📥 Instalar Chat Inunda
          </button>
        ) : isIOS ? (
          <div>
            <button onClick={() => setIosHint((v) => !v)}
              className="text-sm px-3 py-1.5 rounded-md border"
              style={{ color: 'var(--inunda-cyan)', borderColor: 'var(--inunda-border)' }}>
              📱 Como instalar no iPhone/iPad
            </button>
            {iosHint && (
              <div className="mt-3 px-3 py-2.5 rounded-lg text-xs leading-relaxed"
                style={{ background: 'rgba(0,212,232,0.08)', color: 'var(--inunda-text-muted)', border: '1px solid rgba(0,212,232,0.25)' }}>
                1. Toque no botão <strong>Compartilhar ⎙</strong> do Safari<br/>
                2. Toque em <strong>"Adicionar à Tela de Início"</strong><br/>
                3. Confirma
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm italic" style={{ color: 'var(--inunda-text-faded)' }}>
            Seu navegador não está oferecendo instalação. Tente Chrome ou Edge (desktop) ou recarregar a página.
          </p>
        )}
      </div>

      {/* Notificações */}
      <div className="rounded-xl border p-5"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">🔔</span>
          <div className="flex-1">
            <p className="font-semibold" style={{ color: 'var(--inunda-text)' }}>Notificações de novas mensagens</p>
            <p className="text-xs" style={{ color: 'var(--inunda-text-muted)' }}>
              Alerta no navegador quando chegar mensagem em outra conversa (aba sem foco).
            </p>
          </div>
        </div>

        {permission === 'unsupported' && (
          <p className="text-sm italic" style={{ color: 'var(--inunda-text-faded)' }}>
            Seu navegador não suporta notificações.
          </p>
        )}
        {permission === 'granted' && (
          <p className="text-sm flex items-center gap-2" style={{ color: '#22c55e' }}>
            <span>✓</span> Notificações ativadas
          </p>
        )}
        {permission === 'denied' && (
          <p className="text-sm" style={{ color: '#ef4444' }}>
            ⚠ Notificações bloqueadas. Habilite manualmente nas configurações do navegador (cadeado ao lado da URL).
          </p>
        )}
        {(permission === 'default' || !permission) && (
          <button onClick={askPermission} className="btn-primary px-4 py-2 rounded-lg text-sm">
            🔔 Ativar notificações
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tab IA por Caixa ──────────────────────────────────────────────
// Cada caixa (WhatsApp instance) tem sua propria IA, com nome, prompt, KB.
// Mostra seletor no topo (funciona desktop + mobile) e renderiza config da caixa selecionada abaixo.
function TabAI() {
  const [instances, setInstances] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    api.get('/ai/instances').then((r) => {
      setInstances(r.data);
      // Restaura ultima selecionada ou pega a primeira
      const last = parseInt(localStorage.getItem('ai_selected_instance') || '0');
      const pick = r.data.find((i) => i.instance_id === last) || r.data[0];
      if (pick) setSelectedId(pick.instance_id);
    }).catch(() => {}).finally(() => setLoadingList(false));
  }, []);

  function pickInstance(id) {
    setSelectedId(id);
    try { localStorage.setItem('ai_selected_instance', String(id)); } catch {}
  }

  if (loadingList) return <p className="text-sm" style={{ color: 'var(--inunda-text-muted)' }}>Carregando…</p>;

  if (instances.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <p className="text-3xl mb-2">📦</p>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--inunda-text)' }}>Nenhuma caixa criada ainda</p>
        <p className="text-xs mb-3" style={{ color: 'var(--inunda-text-muted)' }}>
          Cada IA é vinculada a uma caixa WhatsApp. Conecte uma caixa primeiro.
        </p>
        <a href="/app/connect" className="btn-primary inline-block text-sm px-4 py-2 rounded-lg">+ Conectar caixa</a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Seletor de caixa — funciona em mobile e desktop */}
      <div className="rounded-xl border p-3"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <label className="text-[10px] uppercase tracking-wider font-semibold block mb-1.5" style={{ color: 'var(--inunda-text-faded)' }}>
          📦 Selecione a caixa
        </label>
        <select value={selectedId || ''} onChange={(e) => pickInstance(parseInt(e.target.value))}
          className={`${inputCls} font-medium`}>
          {instances.map((i) => (
            <option key={i.instance_id} value={i.instance_id}>
              {i.display_name || i.instance_name}
              {i.name ? ` — IA: ${i.name}` : ''}
              {i.enabled ? ' • IA ON' : i.has_key ? ' • configurada' : ' • sem config'}
            </option>
          ))}
        </select>
        {/* Pills com toggle rapido entre caixas em desktop */}
        <div className="hidden md:flex flex-wrap gap-1.5 mt-2">
          {instances.map((i) => (
            <button key={i.instance_id} onClick={() => pickInstance(i.instance_id)}
              className="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style={{
                borderColor: i.instance_id === selectedId ? 'var(--inunda-cyan)' : 'var(--inunda-border)',
                background: i.instance_id === selectedId ? 'var(--inunda-cyan-faint)' : 'transparent',
                color: i.instance_id === selectedId ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
              }}>
              {i.display_name || i.instance_name}
              {i.enabled && <span className="ml-1">🟢</span>}
            </button>
          ))}
        </div>
      </div>

      {selectedId && <InstanceAIPanel key={selectedId} instanceId={selectedId} onSaved={() => {
        api.get('/ai/instances').then((r) => setInstances(r.data)).catch(() => {});
      }} />}
    </div>
  );
}

// Painel de config da IA + KB de UMA caixa
function InstanceAIPanel({ instanceId, onSaved }) {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(''); const [err, setErr] = useState('');
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsErr, setModelsErr] = useState('');
  const [tab, setTab] = useState('config'); // config | knowledge

  useEffect(() => {
    setConfig(null); setModels([]); setModelsErr('');
    api.get(`/ai/instances/${instanceId}`).then((r) => setConfig(r.data)).catch(() => {});
  }, [instanceId]);

  async function loadModels(provider, apiKey) {
    if (provider === 'none' || !provider) { setModels([]); setModelsErr(''); return; }
    setLoadingModels(true); setModelsErr('');
    try {
      const { data } = await api.post('/ai/models', { provider, api_key: apiKey || undefined, instance_id: instanceId });
      setModels(data || []);
    } catch (e) {
      setModelsErr(e.response?.data?.error || 'Erro');
      setModels([]);
    } finally { setLoadingModels(false); }
  }

  useEffect(() => {
    if (config?.has_key && config?.provider && config.provider !== 'none' && models.length === 0) {
      loadModels(config.provider);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.has_key, config?.provider, instanceId]);

  if (!config) return <p className="text-sm" style={{ color: 'var(--inunda-text-muted)' }}>Carregando config…</p>;
  const set = (p) => setConfig({ ...config, ...p });

  async function save() {
    setErr(''); setOk(''); setSaving(true);
    try {
      await api.put(`/ai/instances/${instanceId}`, config);
      const { data } = await api.get(`/ai/instances/${instanceId}`);
      setConfig(data);
      setOk('Salvo'); setTimeout(() => setOk(''), 2000);
      if (data.provider !== 'none') loadModels(data.provider);
      onSaved?.();
    }
    catch (e) { setErr(e.response?.data?.error || 'Erro'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs config | knowledge */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
        <button onClick={() => setTab('config')}
          className="px-3 py-1.5 text-sm border-b-2"
          style={{
            color: tab === 'config' ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
            borderColor: tab === 'config' ? 'var(--inunda-cyan)' : 'transparent',
          }}>⚙️ Config</button>
        <button onClick={() => setTab('knowledge')}
          className="px-3 py-1.5 text-sm border-b-2"
          style={{
            color: tab === 'knowledge' ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
            borderColor: tab === 'knowledge' ? 'var(--inunda-cyan)' : 'transparent',
          }}>📚 Conhecimento</button>
      </div>

      {tab === 'config' && (
        <div className="space-y-4 max-w-2xl">
          {err && <Notice type="error">{err}</Notice>}
          {ok && <Notice type="success">{ok}</Notice>}

          <Field label="Nome da IA (interno — usado nos logs)">
            <input value={config.name || ''} onChange={(e) => set({ name: e.target.value })}
              placeholder="Ex: Comercial, Suporte, Atendente noturno..."
              className={inputCls} />
          </Field>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={!!config.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
            <span className="text-sm font-medium" style={{ color: 'var(--inunda-text)' }}>Habilitar IA nesta caixa</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer pl-6 -mt-2">
            <input type="checkbox" checked={config.default_conversation_ai !== false} onChange={(e) => set({ default_conversation_ai: e.target.checked })} className="w-4 h-4 accent-cyan-400 mt-0.5" />
            <div>
              <span className="text-sm block" style={{ color: 'var(--inunda-text)' }}>Novas conversas iniciam com IA <strong>ligada</strong></span>
              <span className="text-xs block mt-0.5" style={{ color: 'var(--inunda-text-faded)' }}>
                Desmarque pra testar — você ativa a IA manualmente conversa por conversa via botão 🤖 no header
              </span>
            </div>
          </label>
          <Field label="Provider">
            <select value={config.provider} onChange={(e) => set({ provider: e.target.value })} className={inputCls}>
              <option value="none">— Nenhum —</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label={`API Key${config.has_key ? ' (já configurada — deixe vazio pra manter)' : ''}`}>
            <div className="flex gap-2">
              <input type="password" placeholder="sk-..." value={config.api_key || ''}
                onChange={(e) => set({ api_key: e.target.value })}
                className={`${inputCls} font-mono-inunda flex-1`} />
              <button type="button"
                onClick={() => loadModels(config.provider, config.api_key)}
                disabled={loadingModels || config.provider === 'none' || (!config.api_key && !config.has_key)}
                title="Buscar modelos disponíveis"
                className="text-xs px-3 py-2 rounded-lg border whitespace-nowrap disabled:opacity-40"
                style={{ borderColor: 'var(--inunda-border)', color: 'var(--inunda-cyan)' }}>
                {loadingModels ? '⏳' : '🔄 Listar modelos'}
              </button>
            </div>
          </Field>
          <Field label="Modelo">
            {models.length > 0 ? (
              <select value={config.model || ''} onChange={(e) => set({ model: e.target.value })}
                className={`${inputCls} font-mono-inunda`}>
                <option value="">— Selecione —</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : (
              <input placeholder={config.provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini'}
                value={config.model || ''} onChange={(e) => set({ model: e.target.value })}
                className={`${inputCls} font-mono-inunda`} />
            )}
            {modelsErr && <p className="text-[11px] mt-1" style={{ color: '#fca5a5' }}>{modelsErr}</p>}
            {models.length > 0 && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--inunda-text-faded)' }}>
                {models.length} modelos carregados
              </p>
            )}
          </Field>
          <Field label="System prompt (contexto exclusivo desta caixa)">
            <textarea rows={5} placeholder="Voce e atendente da..."
              value={config.system_prompt || ''} onChange={(e) => set({ system_prompt: e.target.value })}
              className={`${inputCls} resize-y`} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Pausa (s)"><input type="number" value={config.pause_seconds ?? 600} onChange={(e) => set({ pause_seconds: parseInt(e.target.value || '0') })} className={inputCls} /></Field>
            <Field label="Max tokens"><input type="number" value={config.max_tokens ?? 1024} onChange={(e) => set({ max_tokens: parseInt(e.target.value || '1024') })} className={inputCls} /></Field>
            <Field label="Temperature"><input type="number" step="0.1" value={config.temperature ?? 0.7} onChange={(e) => set({ temperature: parseFloat(e.target.value || '0.7') })} className={inputCls} /></Field>
          </div>

          <div className="border-t pt-4 mt-4 space-y-3" style={{ borderColor: 'var(--inunda-border)' }}>
            <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>
              🛡 Segurança WhatsApp (anti-ban)
            </p>
            <Field label="Máx. mensagens por minuto (desta caixa)">
              <input type="number" min={1} max={60} value={config.max_msgs_per_minute ?? 15}
                onChange={(e) => set({ max_msgs_per_minute: parseInt(e.target.value || '15') })}
                className={inputCls} />
              <p className="text-[10px] mt-1" style={{ color: 'var(--inunda-text-faded)' }}>
                Recomendado: 10-15 pra números novos, até 25-30 pra contas antigas. Atinge o limite → IA pula resposta.
              </p>
            </Field>

            <Field label="Palavras de opt-out (cliente diz isso → IA é desativada nessa conversa)">
              <textarea rows={2} value={config.opt_out_keywords || ''}
                onChange={(e) => set({ opt_out_keywords: e.target.value })}
                placeholder="parar, stop, descadastrar, ..."
                className={`${inputCls} resize-y`} />
              <p className="text-[10px] mt-1" style={{ color: 'var(--inunda-text-faded)' }}>
                Separe por vírgula. Match parcial e case-insensitive (sem acentos).
              </p>
            </Field>

            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={!!config.business_hours_enabled}
                onChange={(e) => set({ business_hours_enabled: e.target.checked })} className="w-4 h-4 accent-cyan-400" />
              <span className="text-sm" style={{ color: 'var(--inunda-text)' }}>Limitar horário comercial (fora do horário, IA não responde)</span>
            </label>
            {config.business_hours_enabled && (
              <div className="grid grid-cols-3 gap-3 pl-7">
                <Field label="Início"><input type="time" value={config.business_hours_start || '08:00'}
                  onChange={(e) => set({ business_hours_start: e.target.value })} className={inputCls} /></Field>
                <Field label="Fim"><input type="time" value={config.business_hours_end || '22:00'}
                  onChange={(e) => set({ business_hours_end: e.target.value })} className={inputCls} /></Field>
                <Field label="Fuso">
                  <select value={config.business_hours_timezone || 'America/Sao_Paulo'}
                    onChange={(e) => set({ business_hours_timezone: e.target.value })} className={inputCls}>
                    <option value="America/Sao_Paulo">Brasília (BRT)</option>
                    <option value="America/Recife">Recife (BRT)</option>
                    <option value="America/Manaus">Manaus (AMT)</option>
                    <option value="America/Belem">Belém (BRT)</option>
                    <option value="America/Rio_Branco">Rio Branco (ACT)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </Field>
              </div>
            )}
          </div>

          <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Salvando…' : 'Salvar config'}</button>
        </div>
      )}

      {tab === 'knowledge' && <KnowledgePanel instanceId={instanceId} />}
    </div>
  );
}

// Painel de Knowledge Base de UMA caixa
function KnowledgePanel({ instanceId }) {
  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [text, setText] = useState({ title: '', content: '' });
  const [err, setErr] = useState('');
  function load() { api.get('/knowledge', { params: { instance_id: instanceId } }).then((r) => setItems(r.data)).catch(() => {}); }
  useEffect(load, [instanceId]);

  async function uploadFile(f) {
    if (!f) return;
    setErr('');
    const form = new FormData(); form.append('file', f); form.append('instance_id', instanceId);
    try { await api.post('/knowledge/file', form, { headers: { 'Content-Type': 'multipart/form-data' } }); load(); }
    catch (e) { setErr(e.response?.data?.error || 'Erro ao subir'); }
  }
  async function addUrl() {
    if (!url.trim()) return;
    setErr('');
    try { await api.post('/knowledge/url', { url, title: url, instance_id: instanceId }); setUrl(''); load(); }
    catch (e) { setErr(e.response?.data?.error || 'Erro'); }
  }
  async function addText() {
    if (!text.title || !text.content) return;
    setErr('');
    try { await api.post('/knowledge/text', { ...text, instance_id: instanceId }); setText({ title: '', content: '' }); load(); }
    catch (e) { setErr(e.response?.data?.error || 'Erro'); }
  }
  async function del(id) {
    if (!confirm('Remover?')) return;
    try { await api.delete(`/knowledge/${id}`); load(); } catch {}
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <Notice type="info">
        Knowledge específico desta caixa — injetado só no prompt da IA dela.
        Suporta arquivos .txt / .md / .csv / .json, URLs públicas e texto livre.
      </Notice>
      {err && <Notice type="error">{err}</Notice>}

      <div className="rounded-xl border p-4 space-y-3"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>📎 Arquivo</p>
        <input type="file" accept=".txt,.md,.csv,.json,text/*"
          onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ''; }}
          className="text-sm" style={{ color: 'var(--inunda-text)' }} />
      </div>

      <div className="rounded-xl border p-4 space-y-3"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>🔗 URL</p>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..."
            className={`${inputCls} flex-1`} />
          <button onClick={addUrl} disabled={!url.trim()} className={btnPrimary}>+ Adicionar</button>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3"
        style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
        <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--inunda-text-faded)' }}>📝 Texto livre</p>
        <input value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })}
          placeholder="Título (ex: FAQ produto X)" className={inputCls} />
        <textarea rows={4} value={text.content} onChange={(e) => setText({ ...text, content: e.target.value })}
          placeholder="Cole aqui o conteúdo..." className={`${inputCls} resize-y`} />
        <button onClick={addText} disabled={!text.title || !text.content} className={btnPrimary}>+ Adicionar</button>
      </div>

      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm italic" style={{ color: 'var(--inunda-text-faded)' }}>Nenhum item ainda nesta caixa</p>}
        {items.map((it) => (
          <div key={it.id} className="rounded-lg border p-3 flex items-start gap-3"
            style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
            <span>{it.kind === 'file' ? '📎' : it.kind === 'url' ? '🔗' : '📝'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{it.title}</p>
              {it.source && <p className="text-[11px] truncate font-mono-inunda" style={{ color: 'var(--inunda-text-faded)' }}>{it.source}</p>}
              <p className="text-xs truncate mt-1" style={{ color: 'var(--inunda-text-muted)' }}>{it.preview}…</p>
            </div>
            <button onClick={() => del(it.id)} className="text-red-400 text-xs hover:text-red-600">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab Atendentes ────────────────────────────────────────────────
function TabAgents() {
  const { user: me } = useAuthStore();
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState('');
  function load() { api.get('/companies/agents').then((r) => setAgents(r.data)).catch(() => {}); }
  useEffect(load, []);

  async function save() {
    setErr('');
    try {
      if (editing) {
        const payload = { ...form, active: editing.active };
        if (!form.password) delete payload.password;
        await api.put(`/companies/agents/${editing.id}`, payload);
      } else {
        await api.post('/companies/agents', form);
      }
      setForm({ name: '', email: '', password: '', role: 'agent' });
      setShowForm(false); setEditing(null);
      load();
    } catch (e) { setErr(e.response?.data?.error || 'Erro'); }
  }
  async function toggleActive(a) {
    try { await api.put(`/companies/agents/${a.id}`, { name: a.name, email: a.email, role: a.role, active: !a.active }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro'); }
  }

  async function delAgent(a) {
    if (a.id === me?.id) { alert('Você não pode deletar a si mesmo'); return; }
    if (!confirm(`Deletar o atendente "${a.name}"? Isso remove ele desta empresa.`)) return;
    try { await api.delete(`/companies/agents/${a.id}`); load(); }
    catch (e) { alert(e.response?.data?.error || 'Erro ao deletar'); }
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--inunda-text-muted)' }}>
          {agents.filter((a) => a.active).length} ativo{agents.filter((a) => a.active).length !== 1 ? 's' : ''} · {agents.length} total
        </p>
        <button onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', email: '', password: '', role: 'agent' }); setErr(''); }}
          className={btnPrimary}>+ Novo atendente</button>
      </div>

      {err && <Notice type="error">{err}</Notice>}

      {showForm && (
        <div className="rounded-xl border p-4 space-y-3"
          style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)' }}>
          <p className="font-semibold text-sm" style={{ color: 'var(--inunda-text)' }}>{editing ? 'Editar atendente' : 'Novo atendente'}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></Field>
            <Field label={`Senha${editing ? ' (vazio = manter)' : ''}`}>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Papel">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                <option value="agent">Agente</option>
                <option value="owner">Owner (admin)</option>
                <option value="viewer">Viewer (só leitura)</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className={btnPrimary}>{editing ? 'Salvar' : 'Criar'}</button>
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="text-sm px-3 py-2" style={{ color: 'var(--inunda-text-muted)' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {agents.map((a) => (
          <div key={a.id} className="rounded-lg border p-3 flex items-center gap-3"
            style={{ background: 'var(--inunda-bg-surface)', borderColor: 'var(--inunda-border)', opacity: a.active ? 1 : 0.55 }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
              {a.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium" style={{ color: 'var(--inunda-text)' }}>{a.name}</p>
                {me?.id === a.id && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>você</span>}
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: a.role === 'owner' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                           color: a.role === 'owner' ? '#c084fc' : 'var(--inunda-text-muted)' }}>{a.role}</span>
                {!a.active && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>inativo</span>}
              </div>
              <p className="text-xs truncate" style={{ color: 'var(--inunda-text-muted)' }}>{a.email}</p>
            </div>
            <button onClick={() => { setEditing(a); setForm({ name: a.name, email: a.email, password: '', role: a.role }); setShowForm(true); setErr(''); }}
              className="text-xs px-3 py-1.5 rounded-md" style={{ color: 'var(--inunda-cyan)' }}>Editar</button>
            {me?.id !== a.id && (
              <>
                <button onClick={() => toggleActive(a)}
                  className="text-xs px-2 py-1.5 rounded-md"
                  style={{ color: a.active ? '#fbbf24' : '#22c55e' }}>
                  {a.active ? 'Desativar' : 'Ativar'}
                </button>
                <button onClick={() => delAgent(a)}
                  className="text-xs px-2 py-1.5 rounded-md"
                  style={{ color: '#ef4444' }}>
                  Excluir
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab Storage (S3) ──────────────────────────────────────────────
function TabStorage() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api.get('/storage').then((r) => setCfg(r.data)).catch(() => {}); }, []);
  if (!cfg) return <p className="text-sm text-white/50">Carregando…</p>;
  const set = (p) => setCfg({ ...cfg, ...p });
  async function save() {
    setErr(''); setOk(''); setSaving(true);
    try { await api.put('/storage', cfg); setOk('Salvo'); setTimeout(() => setOk(''), 2000); }
    catch (e) { setErr(e.response?.data?.error || 'Erro'); }
    finally { setSaving(false); }
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <Notice type="info">
        Por padrão arquivos enviados ficam no disco do container (perdidos em redeploy).
        Configurando S3 (ou compatível MinIO/R2/B2), os anexos do chat ficam persistentes.
      </Notice>
      {err && <Notice type="error">{err}</Notice>}
      {ok && <Notice type="success">{ok}</Notice>}
      <Field label="Provider">
        <select value={cfg.provider} onChange={(e) => set({ provider: e.target.value })} className={inputCls}>
          <option value="local">Local (disco do container)</option>
          <option value="s3">S3 (AWS / MinIO / R2 / B2)</option>
        </select>
      </Field>
      {cfg.provider === 's3' && (
        <>
          <Field label="Endpoint (opcional — só pra MinIO/R2/B2)">
            <input value={cfg.endpoint || ''} onChange={(e) => set({ endpoint: e.target.value })}
              placeholder="https://s3.us-east-1.amazonaws.com" className={`${inputCls} font-mono-inunda`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region"><input value={cfg.region || ''} onChange={(e) => set({ region: e.target.value })} placeholder="us-east-1" className={inputCls} /></Field>
            <Field label="Bucket"><input value={cfg.bucket || ''} onChange={(e) => set({ bucket: e.target.value })} placeholder="meu-bucket" className={inputCls} /></Field>
          </div>
          <Field label={`Access Key${cfg.has_key ? ' (já configurada — deixe vazio pra manter)' : ''}`}>
            <input type="password" value={cfg.access_key || ''} onChange={(e) => set({ access_key: e.target.value })}
              placeholder="AKIA…" className={`${inputCls} font-mono-inunda`} />
          </Field>
          <Field label={`Secret Key${cfg.has_secret ? ' (já configurada — deixe vazio pra manter)' : ''}`}>
            <input type="password" value={cfg.secret_key || ''} onChange={(e) => set({ secret_key: e.target.value })}
              className={`${inputCls} font-mono-inunda`} />
          </Field>
          <Field label="URL pública (opcional — pra CDN)">
            <input value={cfg.public_url || ''} onChange={(e) => set({ public_url: e.target.value })}
              placeholder="https://cdn.exemplo.com" className={inputCls} />
          </Field>
        </>
      )}
      <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Salvando…' : 'Salvar'}</button>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────
const inputCls = "w-full bg-white/5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-400";
const btnPrimary = "btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50";

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--inunda-text-faded)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────
export default function Settings() {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem('settings_tab') || 'app';
      // Migra valor antigo 'knowledge' (removida) → ai
      return saved === 'knowledge' ? 'ai' : saved;
    } catch { return 'app'; }
  });
  useEffect(() => { try { localStorage.setItem('settings_tab', tab); } catch {} }, [tab]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 md:p-10">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--inunda-text)' }}>Configurações</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--inunda-text-muted)' }}>Ajustes da sua empresa</p>

        <div className="flex gap-1 border-b mb-5 -mx-2 px-2 overflow-x-auto"
          style={{ borderColor: 'var(--inunda-border)' }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap"
              style={{
                color: tab === t.id ? 'var(--inunda-cyan)' : 'var(--inunda-text-muted)',
                borderColor: tab === t.id ? 'var(--inunda-cyan)' : 'transparent',
              }}>
              <span>{t.icon}</span>
              <span className="font-medium">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Cada tab é renderizada inteira (não keep-mount pra simplicidade) */}
        {tab === 'app'    && <TabApp />}
        {tab === 'ai'     && <TabAI />}
        {tab === 'agents' && <TabAgents />}
      </div>
    </div>
  );
}
