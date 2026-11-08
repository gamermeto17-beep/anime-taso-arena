import { useState } from 'react';
import { login, register, type Session } from '../net/auth';

export function LoginScreen({ onDone }: { onDone: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = username.trim().length >= 3 && password.length >= (mode === 'register' ? 8 : 1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await (mode === 'login' ? login : register)(username.trim(), password);
      onDone(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-4 p-6 text-center" onSubmit={submit}>
      <h1 className="text-5xl font-black leading-none">
        ANIME
        <br />
        TASO ARENA
      </h1>
      <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-white/10 p-1 text-sm font-bold">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`rounded-lg py-2 ${mode === m ? 'bg-amber-300 text-slate-900' : ''}`}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
          >
            {m === 'login' ? 'Giriş yap' : 'Kayıt ol'}
          </button>
        ))}
      </div>
      <div className="w-full text-left">
        <label className="text-xs font-bold uppercase tracking-widest text-amber-300">Kullanıcı adı</label>
        <input
          autoFocus
          autoComplete="username"
          maxLength={16}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-xl bg-white/10 px-4 py-3 text-lg font-bold outline-none ring-amber-300 focus:ring-2"
        />
      </div>
      <div className="w-full text-left">
        <label className="text-xs font-bold uppercase tracking-widest text-amber-300">Parola</label>
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          maxLength={72}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl bg-white/10 px-4 py-3 text-lg font-bold outline-none ring-amber-300 focus:ring-2"
        />
        {mode === 'register' && <div className="mt-1 text-xs text-slate-400">En az 8 karakter. Kullanıcı adı: 3-16 harf/rakam/_/-</div>}
      </div>
      {error && <div className="w-full rounded-xl bg-rose-600/80 px-3 py-2 text-sm font-bold">{error}</div>}
      <button className="btn btn-primary w-full" disabled={!ok || busy} type="submit">
        {busy ? 'Bekle…' : mode === 'login' ? 'GİRİŞ YAP' : 'HESAP OLUŞTUR'}
      </button>
      <p className="text-xs text-slate-400">
        Koleksiyonun hesabına bağlıdır; her cihazdan aynı kullanıcı adı ve parolayla girebilirsin. Parolanı unutursan şu an sıfırlama yoktur.
      </p>
    </form>
  );
}
