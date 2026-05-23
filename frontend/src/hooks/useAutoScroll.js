import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Auto-scroll pra ultima msg.
 * - Carga inicial OU troca de chat: useLayoutEffect (sync antes do paint) →
 *   usuario NAO ve flash do topo da conversa
 * - Msg nova durante o chat: scroll suave
 * - Re-scroll em timers pra cobrir midia que carrega async
 */
export default function useAutoScroll(deps = [], key = null) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const prevKey = useRef(key);
  const isFirstRender = useRef(true);

  // SCROLL SINCRONO antes do paint na primeira render / troca de key
  useLayoutEffect(() => {
    if (!bottomRef.current) return;
    const isNewKey = prevKey.current !== key;
    if (isFirstRender.current || isNewKey) {
      bottomRef.current.scrollIntoView({ block: 'end' });
      // tambem scroll direto no container pra garantir
      const container = bottomRef.current.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
      prevKey.current = key;
      isFirstRender.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  // SCROLL SUAVE em msgs novas (depois do paint)
  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    // Re-scroll pra cobrir midia que carrega async (img/audio/video)
    const timers = [200, 600, 1200].map((ms) =>
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), ms)
    );
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return bottomRef;
}
