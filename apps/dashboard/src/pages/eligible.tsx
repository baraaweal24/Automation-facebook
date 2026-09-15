import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mutate } from '../api';
import { Empty, ErrorBox, Loading, PageHeader } from '../components';
import { useApi } from '../hooks';

export function EligibleGroupsPage() {
  const { id } = useParams(); const navigate = useNavigate();
  const state = useApi<any[]>(`/jobs/${id}/eligible-groups`);
  const job = useApi<any>(`/jobs/${id}`);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const choose = (ids: string[]) => { setSelected(ids); setReviewed(false); key.current = crypto.randomUUID(); };
  const publish = async () => {
    setBusy(true); setError('');
    try { const result = await mutate<any>(`/jobs/${id}/publish`, 'POST', { groupIds: selected, reviewed, requestKey: key.current }); navigate(`/campaigns/${result.campaign.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (state.loading) return <Loading/>;
  const all = state.data ?? [];
  return <><PageHeader title="الجروبات المؤهلة" description={`${all.length} جروب يحقق شروط الوظيفة.`}/>{(error || state.error || job.error) && <ErrorBox message={error || state.error || job.error}/>}
    <section className="card mb-5"><h2 className="mb-3 font-bold">النص الذي سيُنشر</h2><p className="whitespace-pre-wrap leading-8">{job.data?.finalText}</p></section>
    {all.length ? <div className="table-wrap"><table><thead><tr><th><input aria-label="تحديد كل الجروبات" type="checkbox" disabled={busy} checked={selected.length === all.length} onChange={e => choose(e.target.checked ? all.map(g => g.id) : [])}/></th><th>الجروب</th><th>الأعضاء</th><th>التقييم</th></tr></thead><tbody>{all.map(g => <tr key={g.id}><td><input aria-label={`اختيار ${g.name}`} type="checkbox" disabled={busy} checked={selected.includes(g.id)} onChange={e => choose(e.target.checked ? [...selected,g.id] : selected.filter(key => key !== g.id))}/></td><td className="font-bold">{g.name}</td><td>{g.membersCount?.toLocaleString('ar-EG') ?? '—'}</td><td>{g.score == null ? '—' : `${Math.round(g.score)}/100`}</td></tr>)}</tbody></table></div> : <Empty text="لا توجد جروبات منضم إليها وتحقق شروط الاستهداف."/>}
    <label className="my-5 flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy || !selected.length || !job.data} checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>راجعت النص والجروبات المختارة.</label><button className="btn-primary" disabled={busy || !reviewed || !selected.length || !job.data} onClick={publish}>بدء الحملة ({selected.length})</button>
  </>;
}
