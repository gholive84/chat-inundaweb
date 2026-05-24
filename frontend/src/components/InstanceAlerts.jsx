import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import useSocketStore from '../store/socketStore';
import { notify } from '../services/notifications';

/**
 * Banner persistente no topo + listener de socket pra desconexao de caixa.
 * Mostra todas as caixas atualmente desconectadas (verifica no mount + socket events).
 */
export default function InstanceAlerts() {
  const socket = useSocketStore((s) => s.socket) || useSocketStore.getState().connect();
  const [disconnected, setDisconnected] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('dismissed_instance_alerts') || '[]')); }
    catch { return new Set(); }
  });

  function load() {
    api.get('/instances').then((r) => {
      const off = (r.data || []).filter((i) => i.status === 'disconnected' || i.status === 'error');
      setDisconnected(off);
    }).catch(() => {});
  }

  useEffect(() => {
    load();
    // Refresh a cada 60s pra pegar mudancas mesmo sem socket
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onDisc = (payload) => {
      load(); // refetch lista atualizada
      // Browser notification
      notify('⚠ WhatsApp desconectado', {
        body: `Caixa "${payload.displayName || payload.instanceName}" perdeu a conexão. Reconecte em Caixas WhatsApp.`,
        tag: `disc-${payload.instanceId}`,
      });
      // tira da lista de dismissed (era pra alertar de novo)
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(payload.instanceId);
        return next;
      });
    };
    const onReconn = (payload) => {
      load();
      notify('✓ WhatsApp reconectado', {
        body: `Caixa "${payload.displayName || payload.instanceName}" voltou a funcionar.`,
        tag: `reconn-${payload.instanceId}`,
      });
    };
    socket.on('instance:disconnected', onDisc);
    socket.on('instance:reconnected', onReconn);
    return () => {
      socket.off('instance:disconnected', onDisc);
      socket.off('instance:reconnected', onReconn);
    };
  }, [socket]);

  function dismiss(id) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try { sessionStorage.setItem('dismissed_instance_alerts', JSON.stringify([...next])); } catch {}
  }

  const visible = disconnected.filter((i) => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  return (
    <div className="border-b" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
      {visible.map((i) => (
        <div key={i.id} className="px-4 py-2 flex items-center gap-2 text-xs"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
          <span className="text-base">⚠</span>
          <span className="flex-1">
            Caixa <strong>{i.display_name || i.instance_name}</strong> está <strong>desconectada</strong>.
            Mensagens não serão enviadas até reconectar.
          </span>
          <Link to="/app/connect" className="px-2 py-0.5 rounded text-[11px] font-medium"
            style={{ background: 'rgba(239,68,68,0.25)', color: '#fff' }}>
            Reconectar →
          </Link>
          <button onClick={() => dismiss(i.id)}
            title="Fechar aviso (volta a aparecer se nova desconexão)"
            className="px-1.5 hover:opacity-100 opacity-60">×</button>
        </div>
      ))}
    </div>
  );
}
