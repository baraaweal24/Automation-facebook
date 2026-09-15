import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { mutate } from '../api';
import { Badge, ErrorBox, Loading, PageHeader, StatCard } from '../components';
import { useApi } from '../hooks';

export function CampaignPage() {
  const { id } = useParams(); const state = useApi<any>(`/campaigns/${id}`);
  const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) void state.refresh(); }, 5000); return () => clearInterval(timer); }, [id]);
  const act = async (status: string) => { setBusy(true); try { await mutate(`/campaigns/${id}/status`,'POST',{status}); await state.refresh(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  if (!state.data && state.loading) return <Loading/>;
  if (!state.data) return <ErrorBox message={state.error}/>;
  const c = state.data; const count = (...statuses: string[]) => c.posts.filter((p: any) => statuses.includes(p.status)).length;
  return <><PageHeader title={c.job.title} description={`تقرير الحملة • ${c.groups.length} جروب مستهدف ${c.dryRun ? '• تجربة بدون إرسال' : ''}`} actions={<div className="flex items-center gap-3"><Badge status={c.status}/>{['ACTIVE','PAUSED'].includes(c.status) && <button className="btn-secondary" disabled={busy} onClick={() => act(c.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED')}>{c.status === 'PAUSED' ? 'استئناف الحملة' : 'إيقاف الحملة مؤقتًا'}</button>}<a className="btn-secondary" href={`/api/campaigns/${id}/export`}>تصدير CSV</a></div>}/>
    {(error || state.error) && <ErrorBox message={error || state.error}/>}
    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><StatCard title="منشور مؤكد" value={count('POSTED','APPROVED')}/><StatCard title="بانتظار الأدمن" value={count('PENDING_ADMIN_APPROVAL')} tone="amber"/><StatCard title="يحتاج مراجعتك" value={count('MANUAL_ACTION_REQUIRED')} tone="amber"/><StatCard title="فشل / مرفوض" value={count('FAILED','REJECTED')} tone="red"/><StatCard title="تجريبي / متخطى" value={count('WOULD_POST','SKIPPED')} tone="blue"/></div>
    <details className="card mb-5"><summary className="cursor-pointer font-bold">نسخة المحتوى المحفوظة للحملة</summary><p className="mt-3 whitespace-pre-wrap leading-8">{c.contentSnapshot || c.job.finalText}</p></details>
    <div className="table-wrap"><table><thead><tr><th>الجروب</th><th>حالة النشر</th><th>رابط المنشور</th><th>وقت النشر</th><th>النتيجة / المراجعة</th></tr></thead><tbody>{c.posts.map((p: any) => <tr key={p.id}><td className="font-bold">{p.group.name}</td><td><Badge status={p.status}/></td><td>{p.facebookUrl ? <a className="text-blue-700 underline" href={p.facebookUrl} target="_blank" rel="noreferrer">فتح المنشور</a> : 'لم يُحفظ رابط مؤكد'}</td><td>{p.postedAt ? new Date(p.postedAt).toLocaleString('ar-EG') : '—'}</td><td className="max-w-md"><p className="text-sm">{[...p.history].reverse().find((h: any) => h.reason)?.reason ?? '—'}</p>{['MANUAL_ACTION_REQUIRED','FAILED','PENDING_ADMIN_APPROVAL','POSTED','SKIPPED'].includes(p.status) && <PostReview post={p} refresh={state.refresh}/>}</td></tr>)}</tbody></table></div>
    {c.posts.length < c.groups.length && <p className="mt-4 text-sm text-slate-500">جاري تجهيز باقي الجروبات عند تشغيل الأتمتة.</p>}
  </>;
}
function PostReview({post,refresh}: {post:any;refresh:()=>Promise<void>}) {
  const [status,setStatus] = useState('APPROVED'); const [reason,setReason] = useState(''); const [link,setLink] = useState(post.facebookUrl ?? '');
  const [absent,setAbsent] = useState(false); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  return <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-blue-700">مراجعة النتيجة يدويًا</summary><form className="mt-3 space-y-3" onSubmit={async e => { e.preventDefault();setBusy(true);setError('');try{await mutate(`/posts/${post.id}/status`,'POST',{status,reason,...(link ? {facebookUrl:link}:{}),confirmedAbsent:absent});await refresh();}catch(e){setError(e instanceof Error ? e.message:String(e));}finally{setBusy(false);}}}>
    <a className="text-sm text-blue-700 underline" href={post.group.canonicalUrl} target="_blank" rel="noreferrer">افتح الجروب للتحقق</a>
    <label className="block"><span className="label">النتيجة</span><select className="input" value={status} onChange={e=>setStatus(e.target.value)}><option value="APPROVED">المنشور ظاهر ومقبول</option><option value="PENDING_ADMIN_APPROVAL">بانتظار الأدمن</option><option value="REJECTED">مرفوض</option><option value="SKIPPED">تخطي</option><option value="QUEUED">إعادة المحاولة بعد التحقق</option></select></label>
    {status==='APPROVED' && <label className="block"><span className="label">رابط المنشور</span><input className="input" type="url" required value={link} onChange={e=>setLink(e.target.value)}/></label>}
    <label className="block"><span className="label">سبب القرار</span><input className="input" required minLength={5} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {status==='QUEUED' && <label className="flex gap-2 text-xs"><input type="checkbox" required checked={absent} onChange={e=>setAbsent(e.target.checked)}/>راجعت الجروب وتأكدت أن المنشور غير موجود ولا ينتظر موافقة.</label>}
    {error && <ErrorBox message={error}/>}<button className="btn-secondary" disabled={busy}>حفظ القرار</button>
  </form></details>;
}
