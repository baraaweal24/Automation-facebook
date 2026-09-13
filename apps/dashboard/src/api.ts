let csrfToken = '';
export function setCsrf(value: string) { csrfToken = value; }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD'].includes(options.method ?? 'GET') && csrfToken) headers.set('x-csrf-token', csrfToken);
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? 'تعذر تنفيذ الطلب.');
  return data;
}

export const mutate = <T>(path: string, method: string, body?: unknown) => api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
