// Helper de notificacoes nativas do browser
export function getPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return await Notification.requestPermission();
}

// Envia notificacao se permitido e aba nao esta focada
export function notify({ title, body, tag, icon = '/icone-chat.png', onClick }) {
  if (typeof Notification === 'undefined') return null;
  if (Notification.permission !== 'granted') return null;
  if (document.visibilityState === 'visible' && document.hasFocus()) return null;
  try {
    const n = new Notification(title, { body, tag, icon, silent: false });
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
    return n;
  } catch (e) {
    console.warn('Notification falhou:', e);
    return null;
  }
}
