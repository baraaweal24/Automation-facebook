import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, FileText, RefreshCw, Sparkles, Users } from 'lucide-react';
import { api, mutate } from '../api';
import { Badge, ErrorBox, PageHeader } from '../components';
import { useApi } from '../hooks';

interface Group { id: string; name: string; canonicalUrl: string; membersCount: number | null; postingEnabled: boolean; decisionStatus: string; blacklist: unknown }
interface Draft { id: string; title: string; sourceData: string; instructions: string; groupIdsJson: string; finalText: string; status: string; chatUrl: string | null; lastError: string | null }
interface Job { id: string; title: string; finalText: string; [key: string]: unknown }
export function ContentStudioPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groups = useApi<{ groups: Group[]; sync: { status: string; lastError: string | null } | null }>('/my-groups');
  const drafts = useApi<Draft[]>('/content-drafts');
  const jobs = useApi<{ items: Job[] }>('/jobs?pageSize=100');
  const automation = useApi<{ state: string; dryRun: boolean }>('/automation/status');
  const [id, setId] = useState(params.get('draft') ?? '');
  const [title, setTitle] = useState('');
  const [sourceData, setSourceData] = useState('');
  const [instructions, setInstructions] = useState('اكتب بالعربية المصرية بأسلوب واضح ومهني، مع دعوة للتواصل من البيانات المتاحة.');
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const invalidate = () => { setReviewed(false); requestKey.current = crypto.randomUUID(); setMessage(''); };
  const available = (groups.data?.groups ?? []).filter(g => g.postingEnabled && !g.blacklist && g.decisionStatus !== 'MANUALLY_REJECTED');
  const visible = available.filter(g => g.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const validSelection = selected.length > 0 && selected.every(key => available.some(g => g.id === key));
  const editable = !busy && !generating;

  const applyDraft = (draft: Draft) => {
    setId(draft.id); setTitle(draft.title); setSourceData(draft.sourceData); setInstructions(draft.instructions);
    setSelected(JSON.parse(draft.groupIdsJson)); setText(draft.finalText); setChatUrl(draft.chatUrl);
    setGenerating(draft.status === 'GENERATING'); setError(draft.lastError ?? ''); invalidate();
    setParams({ draft: draft.id }, { replace: true });
  };
  useEffect(() => {
    const initial = params.get('draft');
    if (initial) void api<Draft>(`/content-drafts/${initial}`).then(applyDraft).catch(e => setError(e.message));
    // Load the URL draft on mount; subsequent switches are explicit to avoid overwriting edits.
  }, []);
  useEffect(() => {
    if (!generating || !id) return;
    let active = true;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api<Draft>(`/content-drafts/${id}`).then(draft => {
        if (!active || draft.status === 'GENERATING') return;
        setGenerating(false); setText(draft.finalText); setChatUrl(draft.chatUrl); setError(draft.lastError ?? '');
        setReviewed(false); requestKey.current = crypto.randomUUID();
        if (!draft.lastError) setMessage('تم توليد المحتوى. راجع التفاصيل وعدّل النص قبل النشر.');
        void drafts.refresh();
      }).catch(e => { if (active) setError(e.message); }).finally(() => { pending = false; });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [generating, id]);
  useEffect(() => {
    if (!['QUEUED','RUNNING','RETRY'].includes(groups.data?.sync?.status ?? '')) return;
    const timer = setInterval(() => { void groups.refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [groups.data?.sync?.status]);

  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ الطلب.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    const draft = await mutate<Draft>(id ? `/content-drafts/${id}` : '/content-drafts', id ? 'PATCH' : 'POST', { title, sourceData, instructions, groupIds: selected, finalText: text });
    setId(draft.id); setParams({ draft: draft.id }, { replace: true });
    return draft;
  };
  const generate = () => act(async () => {
    const draft = await save();
    await mutate(`/content-drafts/${draft.id}/generate`, 'POST');
    setGenerating(true); setReviewed(false);
  });
  const publish = () => act(async () => {
    if (!reviewed || !validSelection) throw new Error('راجع النص والجروبات المختارة أولًا.');
    const draft = await save();
    const result = await mutate<{ campaign: { id: string } }>(`/content-drafts/${draft.id}/publish`, 'POST', { groupIds: selected, reviewed: true, requestKey: requestKey.current, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) });
    navigate(`/campaigns/${result.campaign.id}`);
  });

  return <>
    <PageHeader title="استوديو المحتوى" description="جروباتك، بياناتك، وبوست تراجعه قبل ما يوصل لجمهورك." actions={<div className="flex gap-2"><button className="btn-secondary" disabled={!editable} onClick={() => act(async () => { await mutate('/chatgpt/open','POST'); setMessage('سجّل الدخول بنفسك في نافذة ChatGPT، ثم ارجع واضغط توليد.'); })}><Sparkles size={17}/>ربط حساب ChatGPT</button><button className="btn-secondary" disabled={!editable} onClick={() => act(async () => { await mutate('/chatgpt/close','POST'); setMessage('تم إغلاق نافذة ChatGPT وحفظ الجلسة.'); })}>إغلاق جلسة الشات</button></div>}/>
    {(error || groups.error || drafts.error) && <ErrorBox message={error || groups.error || drafts.error}/>}
    {message && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    <div className="mb-6 grid gap-3 sm:grid-cols-3">{[['1','اختار جروباتك',Users],['2','جهّز وولّد المحتوى',Sparkles],['3','راجع وابدأ النشر',Check]].map(([step,label,Icon]) => { const StepIcon = Icon as typeof Users; return <div key={String(step)} className="card flex items-center gap-3 py-4"><StepIcon className="text-brand-600" size={20}/><span className="text-sm font-bold">{String(step)}. {String(label)}</span></div>; })}</div>
    <div className="grid items-start gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <section className="card xl:sticky xl:top-24">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-extrabold">جروبات حسابي</h2><span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">{selected.length} مختار</span></div>
        <button className="btn-secondary mb-3 w-full" disabled={!editable || ['QUEUED','RUNNING','RETRY'].includes(groups.data?.sync?.status ?? '')} onClick={() => act(async () => { await mutate('/my-groups/sync','POST'); await groups.refresh(); setMessage('تمت إضافة جلب الجروبات لقائمة الانتظار.'); })}><RefreshCw size={16}/>جلب الجروبات من فيسبوك</button>
        {groups.data?.sync && <div className="mb-3 text-xs"><Badge status={groups.data.sync.status}/>{groups.data.sync.lastError && <p className="mt-2 text-rose-700">{groups.data.sync.lastError}</p>}</div>}
        <label className="block"><span className="label">ابحث في جروباتك</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="اسم الجروب..."/></label>
        <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable || !visible.length} checked={visible.length > 0 && visible.every(g => selected.includes(g.id))} onChange={e => { invalidate(); setSelected(e.target.checked ? [...new Set([...selected,...visible.map(g => g.id)])] : selected.filter(key => !visible.some(g => g.id === key))); }}/>تحديد نتائج البحث ({visible.length})</label>
        <div className="max-h-[480px] space-y-2 overflow-auto">{visible.map(group => <label key={group.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${selected.includes(group.id) ? 'border-brand-300 bg-brand-50' : 'border-slate-200'}`}><input className="mt-1" type="checkbox" disabled={!editable} checked={selected.includes(group.id)} onChange={e => { invalidate(); setSelected(e.target.checked ? [...selected,group.id] : selected.filter(key => key !== group.id)); }}/><span><strong className="text-sm">{group.name}</strong><span className="mt-1 block text-xs text-slate-500">{group.membersCount?.toLocaleString('ar-EG') ?? '—'} عضو · منضم</span></span></label>)}{!visible.length && <p className="py-8 text-center text-sm leading-7 text-slate-500">{groups.loading ? 'جارٍ تحميل الجروبات...' : 'اربط جلسة فيسبوك ثم اجلب الجروبات، أو غيّر كلمة البحث.'}</p>}</div>
        {!!selected.length && <button className="mt-3 text-sm text-rose-700" disabled={!editable} onClick={() => { setSelected([]); invalidate(); }}>إلغاء كل الاختيارات</button>}
        {!validSelection && selected.length > 0 && <p className="mt-3 text-sm text-rose-700">بعض الاختيارات لم تعد متاحة. ألغِ الاختيارات وحدد الجروبات الحالية.</p>}
      </section>
      <div className="space-y-6">
        <section className="card space-y-4">
          <div className="flex items-center gap-2"><FileText size={20} className="text-brand-600"/><h2 className="text-lg font-extrabold">مصدر المحتوى</h2></div>
          <div className="grid gap-4 md:grid-cols-2"><label><span className="label">مسودة محفوظة</span><select className="input" disabled={!editable} value={id} onChange={e => { if (e.target.value) void act(async () => applyDraft(await api<Draft>(`/content-drafts/${e.target.value}`))); else { setId(''); setTitle(''); setSourceData(''); setText(''); setChatUrl(null); setParams({}); invalidate(); } }}><option value="">منشور جديد</option>{drafts.data?.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
          <label><span className="label">استخدم بيانات وظيفة محفوظة</span><select className="input" disabled={!editable} defaultValue="" onChange={e => { const job = jobs.data?.items.find(j => j.id === e.target.value); if (!job) return; setTitle(job.title); const omitted = new Set(['id','createdAt','updatedAt','imagePath','campaigns','targeting','_count','status','finalText']); setSourceData(JSON.stringify(Object.fromEntries(Object.entries(job).filter(([key,value]) => !omitted.has(key) && value !== null && value !== '')),null,2)); invalidate(); }}><option value="">اختياري — أو اكتب البيانات بنفسك</option>{jobs.data?.items.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label></div>
          <label className="block"><span className="label">عنوان المسودة</span><input className="input" maxLength={200} disabled={!editable} value={title} onChange={e => { setTitle(e.target.value); invalidate(); }} placeholder="مثال: فرص عمل فنادق شرم الشيخ"/></label>
          <label className="block"><span className="label">البيانات اللي البوست هيتبني عليها</span><textarea className="input min-h-44" maxLength={20000} disabled={!editable} value={sourceData} onChange={e => { setSourceData(e.target.value); invalidate(); }} placeholder="اكتب التفاصيل الحقيقية، المميزات، الشروط، ووسيلة التواصل..."/></label>
          <label className="block"><span className="label">أسلوب البوست وتعليمات الكتابة</span><textarea className="input" rows={3} maxLength={2000} disabled={!editable} value={instructions} onChange={e => { setInstructions(e.target.value); invalidate(); }}/></label>
          <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" disabled={!editable || !validSelection || title.trim().length < 2 || sourceData.trim().length < 10} onClick={generate}><Sparkles size={17}/>{generating ? 'ChatGPT بيكتب البوست...' : 'توليد البوست بحساب ChatGPT'}</button><p className="text-xs text-slate-500">ستُرسل البيانات وأسماء الجروبات المختارة إلى حساب ChatGPT.</p></div>
        </section>
        <section className="card space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">معاينة وتعديل البوست</h2>{chatUrl && <a className="text-sm text-blue-700 underline" href={chatUrl} target="_blank" rel="noreferrer">فتح المحادثة</a>}</div>
          <textarea aria-label="نص المنشور النهائي" className="input min-h-64 leading-8" disabled={!editable} value={text} maxLength={20000} onChange={e => { setText(e.target.value); invalidate(); }} placeholder="البوست المولّد هيظهر هنا. تقدر كمان تكتب أو تلصق المحتوى بنفسك."/>
          <div className="flex justify-between text-xs text-slate-500"><span>{text.length.toLocaleString('ar-EG')} حرف</span><span>{selected.length} جروب مستهدف</span></div>
          <label className="block max-w-sm"><span className="label">موعد النشر (اختياري — بتوقيت جهازك)</span><input className="input" type="datetime-local" disabled={!editable} value={scheduledAt} onChange={e => { setScheduledAt(e.target.value); invalidate(); }}/></label>
          <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm leading-6"><input className="mt-1" type="checkbox" disabled={!editable || text.trim().length < 10 || !validSelection} checked={reviewed} onChange={e => setReviewed(e.target.checked)}/><span>راجعت صحة النص والجروبات المختارة، والمحتوى مناسب للنشر فيها.</span></label>
          <div className="flex flex-wrap gap-3"><button className="btn-primary" disabled={!editable || !reviewed || !validSelection || text.trim().length < 10} onClick={publish}>{automation.data?.dryRun ? 'بدء حملة تجريبية' : 'نشر في الجروبات المختارة'} ({selected.length})</button><button className="btn-secondary" disabled={!editable || !validSelection || title.trim().length < 2 || sourceData.trim().length < 10} onClick={() => act(async () => { await save(); await drafts.refresh(); setMessage('تم حفظ المسودة.'); })}>حفظ المسودة</button></div>
          <p className="text-xs leading-6 text-slate-500">{automation.data?.dryRun ? 'وضع الاختبار مفعّل: الحملة لن ترسل منشورات فعلية إلى فيسبوك.' : 'الحملة تنشر نسخة النص الذي راجعته في كل جروب مختار.'} {automation.data?.state !== 'RUNNING' && 'شغّل الأتمتة من أعلى الصفحة لتنفيذ المهام المنتظرة.'}</p>
        </section>
      </div>
    </div>
  </>;
}
