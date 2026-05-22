import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import useAuthStore from '../store/authStore';

export default function Signup() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/signup', form);
      setAuth(data);
      navigate('/app/connect');
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao cadastrar');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at top, rgba(0,212,232,0.08), transparent 60%), #0A1628' }}>
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/inunda-logo.png" alt="Inundaweb" draggable={false} className="h-10 w-auto mb-5" />
          <h1 className="text-white text-xl font-semibold tracking-tight">Criar conta</h1>
          <p className="text-cyan-400/60 text-sm mt-1">Comece com sua empresa</p>
        </div>

        <div className="rounded-2xl p-7 border border-white/10"
          style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)' }}>
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl text-sm border"
              style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
              {error}
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            {[
              { k: 'companyName', label: 'Nome da empresa', type: 'text', placeholder: 'Inundaweb' },
              { k: 'name',        label: 'Seu nome',        type: 'text', placeholder: 'Gustavo' },
              { k: 'email',       label: 'Email',           type: 'email' },
              { k: 'password',    label: 'Senha (min 6)',    type: 'password' },
            ].map((f) => (
              <div key={f.k}>
                <label className="text-xs text-cyan-300/60 uppercase tracking-wider font-semibold">{f.label}</label>
                <input required type={f.type} placeholder={f.placeholder} value={form[f.k]}
                  onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                  className="mt-1.5 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400" />
              </div>
            ))}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl py-2.5 text-sm font-semibold mt-2 disabled:opacity-50"
              style={{ background: '#00D4E8', color: '#0A1628' }}>
              {loading ? 'Criando...' : 'Criar conta e conectar WhatsApp'}
            </button>
          </form>
        </div>
        <p className="text-center mt-6 text-xs text-cyan-300/40">
          Já tem conta? <Link to="/login" className="text-cyan-400 hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
