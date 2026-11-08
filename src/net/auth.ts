const SESSION_KEY = 'taso.session';

export interface Session {
  token: string;
  username: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return typeof s.token === 'string' && typeof s.username === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* gizli mod: oturum yalnızca bu sekmede yaşar */
  }
}

async function call(path: string, body: unknown): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Sunucuya ulaşılamıyor, tekrar dene');
  }
  const data = (await res.json().catch(() => ({}))) as { token?: string; username?: string; error?: string };
  if (!res.ok || !data.token || !data.username) throw new Error(data.error ?? 'İşlem başarısız');
  return { token: data.token, username: data.username };
}

export const register = (username: string, password: string) => call('/api/register', { username, password });
export const login = (username: string, password: string) => call('/api/login', { username, password });

export async function logout(token: string) {
  try {
    await fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } catch {
    /* çevrim dışıysa yerel oturum yine de silinir */
  }
}
