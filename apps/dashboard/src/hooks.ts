import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useApi<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { setData(await api<T>(path)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } }, [path, ...deps]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error, loading, refresh, setData };
}
