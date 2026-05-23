import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Cache simples
let _users = null;
let _usersP = null;
async function loadUsers() {
  if (_users) return _users;
  if (_usersP) return _usersP;
  _usersP = api.get('/companies/agents').then((r) => { _users = (r.data || []).filter((u) => u.active); return _users; }).catch(() => []);
  return _usersP;
}

/**
 * Input/textarea com autocomplete de @ pra mencionar agentes.
 * Props: value, onChange, placeholder, className, as ('input'|'textarea'), rows, onKeyDown
 */
export default function MentionInput({ value, onChange, placeholder, className, as = 'textarea', rows = 2, onKeyDown, ...rest }) {
  const ref = useRef(null);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const triggerStart = useRef(-1);
  useEffect(() => { loadUsers().then(setUsers); }, []);

  function computeQuery(text, caret) {
    let i = caret - 1;
    while (i >= 0) {
      const c = text[i];
      if (c === '@') {
        const prev = i === 0 ? ' ' : text[i - 1];
        if (/\s/.test(prev) || i === 0) {
          const q = text.slice(i + 1, caret);
          if (/^[A-Za-zÀ-ÿ0-9._-]*$/.test(q)) { triggerStart.current = i; return q; }
        }
        return null;
      }
      if (/\s/.test(c)) return null;
      i--;
    }
    return null;
  }

  function handleChange(e) {
    const newVal = e.target.value;
    onChange(newVal);
    const caret = e.target.selectionStart;
    const q = computeQuery(newVal, caret);
    if (q === null) { setOpen(false); return; }
    setQuery(q); setHi(0); setOpen(true);
  }

  function filtered() {
    if (!query) return users.slice(0, 6);
    const q = query.toLowerCase();
    return users.filter((u) => (u.name || '').toLowerCase().includes(q)).slice(0, 6);
  }

  function pickUser(u) {
    const cur = value || '';
    const start = triggerStart.current;
    if (start < 0) { setOpen(false); return; }
    const caret = ref.current?.selectionStart ?? cur.length;
    const hasSpace = /\s/.test(u.name || '');
    const inserted = hasSpace ? `"${u.name}"` : (u.name || 'user').replace(/\s+/g, '-');
    const next = cur.slice(0, start) + '@' + inserted + ' ' + cur.slice(caret);
    onChange(next);
    setOpen(false);
    setTimeout(() => {
      const pos = start + 1 + inserted.length + 1;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    }, 0);
  }

  function handleKey(e) {
    if (open) {
      const list = filtered();
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && list[hi]) { e.preventDefault(); pickUser(list[hi]); return; }
      if (e.key === 'Escape') { setOpen(false); return; }
    }
    onKeyDown?.(e);
  }

  const Tag = as === 'input' ? 'input' : 'textarea';
  const list = open ? filtered() : [];

  return (
    <div className="relative">
      <Tag ref={ref} value={value} onChange={handleChange} onKeyDown={handleKey}
        placeholder={placeholder} rows={as === 'textarea' ? rows : undefined}
        className={className} {...rest} />
      {open && list.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 z-30 rounded-lg shadow-2xl overflow-hidden min-w-[180px] max-w-[260px]"
          style={{ background: 'var(--inunda-bg-elevated)', border: '1px solid var(--inunda-border)' }}>
          <p className="px-3 py-1 text-[10px] uppercase tracking-wider border-b font-semibold"
            style={{ color: 'var(--inunda-text-faded)', borderColor: 'var(--inunda-border)' }}>Mencionar</p>
          {list.map((u, i) => (
            <button key={u.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); pickUser(u); }}
              onMouseEnter={() => setHi(i)}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5"
              style={{ background: i === hi ? 'var(--inunda-cyan-faint)' : 'transparent', color: 'var(--inunda-text)' }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold"
                style={{ background: 'var(--inunda-cyan-faint)', color: 'var(--inunda-cyan)' }}>
                {u.name?.[0]?.toUpperCase() || '?'}
              </span>
              <span className="text-sm truncate">{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
