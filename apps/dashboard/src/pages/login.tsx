import { LockKeyhole } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api, setCsrf } from '../api';
import { ErrorBox } from '../components';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setLoading(true); setError(''); const form = new FormData(event.currentTarget); try { const result = await api<{ csrfToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ login: form.get('login'), password: form.get('password') }), headers: { 'content-type': 'application/json' } }); setCsrf(result.csrfToken); onLogin(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } };
  return <main className="grid min-h-screen place-items-center bg-ink p-4"><form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"><div className="mb-6 inline-flex rounded-2xl bg-brand-50 p-3 text-brand-700"><LockKeyhole/></div><h1 className="text-2xl font-extrabold">تسجيل الدخول</h1><p className="mb-7 mt-2 text-sm text-slate-500">لوحة إدارة نشر الوظائف</p>{error && <ErrorBox message={error}/>}<label className="label">اسم المستخدم أو البريد</label><input className="input mb-4" name="login" autoComplete="username" required/><label className="label">كلمة المرور</label><input className="input mb-6" type="password" name="password" autoComplete="current-password" minLength={10} required/><button className="btn-primary w-full" disabled={loading}>{loading ? 'جارٍ الدخول...' : 'دخول آمن'}</button></form></main>;
}
