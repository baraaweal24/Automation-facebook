import { FormEvent, useState } from 'react';
import { mutate } from '../api';
import { ErrorBox, Loading, PageHeader } from '../components';
import { useApi } from '../hooks';

const list = (value: FormDataEntryValue | null) => String(value ?? '').split(/[,،\n]/).map((v) => v.trim()).filter(Boolean);

export function SettingsPage() {
  const state = useApi<any>('/settings');
  const [message, setMessage] = useState('');
  if (state.loading) return <Loading/>;
  const rules = state.data?.globalGroupRules ?? {};
  const weights = state.data?.scoreWeights ?? {};
  const automation = state.data?.automationSettings ?? {};

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      await mutate('/settings', 'PATCH', {
        globalGroupRules: { minMembers: Number(form.get('minMembers')) || null, maxMembers: Number(form.get('maxMembers')) || null, minActivity: Number(form.get('minActivity')) || null, minScore: Number(form.get('minScore')), allowedPrivacy: form.getAll('privacy'), requireJobKeywords: form.get('requireJobKeywords') === 'on', allowedKeywords: list(form.get('allowedKeywords')), blockedKeywords: list(form.get('blockedKeywords')), allowedLocations: list(form.get('allowedLocations')), blockedLocations: list(form.get('blockedLocations')) },
        scoreWeights: { members: Number(form.get('members')), activity: Number(form.get('activity')), engagement: Number(form.get('engagement')), keywordRelevance: Number(form.get('keywordRelevance')), locationRelevance: Number(form.get('locationRelevance')) },
        automationSettings: { ...automation, actionDelayMs: Number(form.get('actionDelayMs')), maxGroupsPerSearch: Number(form.get('maxGroupsPerSearch')), maxGroupsToAnalyzePerRun: Number(form.get('maxGroupsToAnalyzePerRun')), maxJoinAttempts: Number(form.get('maxJoinAttempts')), maxPostsPerRun: Number(form.get('maxPostsPerRun')), pageTimeoutMs: Number(form.get('pageTimeoutMs')), retryCount: Number(form.get('retryCount')), pendingJoinRecheckMinutes: Number(form.get('pendingJoinRecheckMinutes')), pendingPostRecheckMinutes: Number(form.get('pendingPostRecheckMinutes')), screenshotOnError: form.get('screenshotOnError') === 'on' },
      });
      setMessage('تم حفظ الإعدادات.'); await state.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); }
  };

  return <>
    <PageHeader title="إعدادات النظام" description="شروط القبول، أوزان التقييم وحدود التشغيل."/>
    {message && (message.startsWith('تم') ? <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{message}</div> : <ErrorBox message={message}/>)}
    <form className="space-y-5" onSubmit={save}>
      <section className="card"><h2 className="mb-4 font-extrabold">شروط الجروبات</h2><div className="grid gap-4 md:grid-cols-4"><NumberField name="minMembers" label="الحد الأدنى للأعضاء" value={rules.minMembers}/><NumberField name="maxMembers" label="الحد الأقصى (اختياري)" value={rules.maxMembers}/><NumberField name="minActivity" label="النشاط اليومي" value={rules.minActivity}/><NumberField name="minScore" label="الحد الأدنى للتقييم" value={rules.minScore}/></div><div className="mt-4 flex flex-wrap gap-5"><Check name="privacy" value="PUBLIC" label="جروبات عامة" checked={rules.allowedPrivacy?.includes('PUBLIC')}/><Check name="privacy" value="PRIVATE" label="جروبات خاصة" checked={rules.allowedPrivacy?.includes('PRIVATE')}/><Check name="requireJobKeywords" label="اشتراط كلمات وظائف" checked={rules.requireJobKeywords}/></div><div className="mt-4 grid gap-4 md:grid-cols-2"><ListField name="allowedKeywords" label="الكلمات المسموحة" value={rules.allowedKeywords}/><ListField name="blockedKeywords" label="الكلمات المحظورة" value={rules.blockedKeywords}/><ListField name="allowedLocations" label="المواقع المسموحة" value={rules.allowedLocations}/><ListField name="blockedLocations" label="المواقع المحظورة" value={rules.blockedLocations}/></div></section>
      <section className="card"><h2 className="mb-4 font-extrabold">أوزان التقييم (%)</h2><div className="grid gap-4 md:grid-cols-5"><NumberField name="members" label="الأعضاء" value={weights.members}/><NumberField name="activity" label="النشاط" value={weights.activity}/><NumberField name="engagement" label="التفاعل" value={weights.engagement}/><NumberField name="keywordRelevance" label="الكلمات" value={weights.keywordRelevance}/><NumberField name="locationRelevance" label="الموقع" value={weights.locationRelevance}/></div></section>
      <section className="card"><h2 className="mb-4 font-extrabold">حدود التشغيل</h2><div className="grid gap-4 md:grid-cols-3"><NumberField name="maxGroupsPerSearch" label="جروبات لكل بحث" value={automation.maxGroupsPerSearch}/><NumberField name="maxGroupsToAnalyzePerRun" label="تحليلات لكل جولة" value={automation.maxGroupsToAnalyzePerRun}/><NumberField name="maxJoinAttempts" label="محاولات انضمام" value={automation.maxJoinAttempts}/><NumberField name="maxPostsPerRun" label="منشورات لكل جولة" value={automation.maxPostsPerRun}/><NumberField name="actionDelayMs" label="الفاصل (مللي ثانية)" value={automation.actionDelayMs}/><NumberField name="pageTimeoutMs" label="مهلة الصفحة" value={automation.pageTimeoutMs}/><NumberField name="retryCount" label="عدد المحاولات" value={automation.retryCount}/><NumberField name="pendingJoinRecheckMinutes" label="فحص الانضمام (دقيقة)" value={automation.pendingJoinRecheckMinutes}/><NumberField name="pendingPostRecheckMinutes" label="فحص المنشور (دقيقة)" value={automation.pendingPostRecheckMinutes}/></div><div className="mt-4"><Check name="screenshotOnError" label="لقطة شاشة عند الخطأ" checked={automation.screenshotOnError}/></div></section>
      <button className="btn-primary">حفظ جميع الإعدادات</button>
    </form>
  </>;
}

function NumberField({ name, label, value }: any) { return <label><span className="label">{label}</span><input className="input" name={name} type="number" min="0" defaultValue={value ?? ''}/></label>; }
function ListField({ name, label, value }: any) { return <label><span className="label">{label}</span><textarea className="input" name={name} rows={3} defaultValue={(value ?? []).join('، ')}/></label>; }
function Check({ name, value, label, checked }: any) { return <label className="flex items-center gap-2 text-sm font-semibold"><input name={name} value={value} type="checkbox" defaultChecked={checked}/>{label}</label>; }
