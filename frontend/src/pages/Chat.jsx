import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

function ConversationList({ items, activeId, onSelect }) {
  return (
    <div className="overflow-y-auto h-full">
      {items.length === 0 && (
        <div className="text-center text-sm py-10" style={{ color: 'var(--inunda-text-faded)' }}>
          Nenhuma conversa ainda — conecte o WhatsApp em "WhatsApp" no menu lateral
        </div>
      )}
      {items.map((c) => {
        const active = c.id === activeId;
        const name = c.contact_name || c.push_name || c.phone;
        return (
          <button key={c.id} onClick={() => onSelect(c.id)}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b ${active ? '' : 'hover:bg-white/[0.03]'}`}
            style={{ borderColor: 'var(--inunda-border)', background: active ? 'var(--inunda-cyan-faint)' : 'transparent' }}>
            {c.profile_pic_url ? (
              <img src={c.profile_pic_url} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                style={{ background: 'var(--inunda-bg-elevated)', color: 'var(--inunda-text)' }}>
                {name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--inunda-text)' }}>{name}</p>
                {c.unread_count > 0 && (
                  <span className="text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center"
                    style={{ background: 'var(--inunda-cyan)', color: 'var(--inunda-bg-deep)' }}>
                    {c.unread_count}
                  </span>
                )}
              </div>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--inunda-text-muted)' }}>
                {c.last_message_preview || '—'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.get('/conversations').then((r) => setItems(r.data)).catch(() => {});
  }, []);

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col"
        style={{ borderColor: 'var(--inunda-border)', background: 'var(--inunda-bg-surface)' }}>
        <div className="p-4 border-b" style={{ borderColor: 'var(--inunda-border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--inunda-text)' }}>Conversas</h2>
        </div>
        <ConversationList items={items} activeId={parseInt(id)} onSelect={(cid) => navigate(`/app/chat/${cid}`)} />
      </div>

      {/* Painel central */}
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8"
        style={{ background: 'var(--inunda-bg-deep)', color: 'var(--inunda-text-muted)' }}>
        {!id ? (
          <>
            <img src="/inunda-logo.png" className="h-10 w-auto mb-4 opacity-50" />
            <p className="text-sm">Selecione uma conversa pra começar</p>
            <p className="text-xs mt-1" style={{ color: 'var(--inunda-text-faded)' }}>
              Em breve: chat completo estilo WhatsApp Web
            </p>
          </>
        ) : (
          <p className="text-sm">Chat da conversa #{id} — UI em construção (Fase 1)</p>
        )}
      </div>
    </div>
  );
}
