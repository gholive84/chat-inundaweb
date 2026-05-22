// Tempo relativo compacto estilo WhatsApp: "agora", "12m", "3h", "2d", "1sem", "01/05"
export function relativeTime(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  const now = new Date();
  const diff = (now - d) / 1000; // segundos
  if (diff < 45) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  // Mais de 7 dias: mostra data
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
