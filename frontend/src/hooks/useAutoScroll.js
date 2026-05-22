import { useEffect, useRef } from 'react';

export default function useAutoScroll(deps = [], key = null) {
  const bottomRef = useRef(null);
  const prevKey = useRef(key);
  useEffect(() => {
    if (!bottomRef.current) return;
    const isNew = prevKey.current !== key;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: isNew ? 'auto' : 'smooth', block: 'end' });
    });
    if (isNew) {
      const timers = [120, 400, 900].map((ms) => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }), ms));
      prevKey.current = key;
      return () => timers.forEach(clearTimeout);
    }
    prevKey.current = key;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return bottomRef;
}
