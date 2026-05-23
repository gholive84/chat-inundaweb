import { useEffect, useRef, useState } from 'react';

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const SPEEDS = [1, 1.5, 2];

export default function AudioPlayer({ src, fromMe }) {
  const ref = useRef(null);
  const barRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onMeta = () => { setDuration(a.duration || 0); setLoading(false); };
    const onTime = () => setCurrent(a.currentTime || 0);
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoad = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('loadstart', onLoad);
    a.addEventListener('canplay', onCanPlay);
    a.preload = 'metadata';
    return () => {
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('loadstart', onLoad);
      a.removeEventListener('canplay', onCanPlay);
    };
  }, [src]);

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed, src]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch((e) => console.warn('play', e));
    else a.pause();
  }

  function seek(e) {
    const a = ref.current;
    const bar = barRef.current;
    if (!a || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const x = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) / rect.width;
    const t = Math.max(0, Math.min(1, x)) * duration;
    a.currentTime = t;
    setCurrent(t);
  }

  const progress = duration ? (current / duration) * 100 : 0;
  const accent = fromMe ? '#fff' : 'var(--inunda-cyan)';
  const trackBg = fromMe ? 'rgba(255,255,255,0.25)' : 'var(--inunda-cyan-faint)';

  return (
    <div className="flex items-center gap-2.5 min-w-[220px] max-w-xs">
      <audio ref={ref} src={src} preload="metadata" />

      <button onClick={toggle}
        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-95"
        style={{ background: accent, color: fromMe ? 'var(--inunda-cyan)' : '#fff' }}>
        {loading ? (
          <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        ) : playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div ref={barRef}
          onMouseDown={seek}
          onTouchStart={seek}
          className="w-full h-1.5 rounded-full cursor-pointer relative"
          style={{ background: trackBg }}>
          <div className="absolute top-0 left-0 h-full rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%`, background: accent }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-[left] duration-100"
            style={{ left: `calc(${progress}% - 6px)`, background: accent, boxShadow: '0 0 0 2px rgba(0,0,0,0.15)' }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] font-mono-inunda" style={{ color: fromMe ? 'rgba(255,255,255,0.7)' : 'var(--inunda-text-muted)' }}>
            {fmt(current)}
          </span>
          <span className="text-[10px] font-mono-inunda" style={{ color: fromMe ? 'rgba(255,255,255,0.5)' : 'var(--inunda-text-faded)' }}>
            {fmt(duration - current)}
          </span>
        </div>
      </div>

      <button onClick={() => {
          const idx = SPEEDS.indexOf(speed);
          setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
        }}
        title="Velocidade de reprodução"
        className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors"
        style={{
          background: speed === 1 ? 'transparent' : (fromMe ? 'rgba(255,255,255,0.18)' : 'var(--inunda-cyan-faint)'),
          color: fromMe ? '#fff' : 'var(--inunda-cyan)',
          opacity: speed === 1 ? 0.6 : 1,
        }}>
        {speed}×
      </button>
    </div>
  );
}
