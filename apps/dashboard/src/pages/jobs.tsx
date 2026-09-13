import { FormEvent, type ReactNode, useState } from 'react';
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, mutate } from '../api';
import { Badge, ErrorBox, Loading, PageHeader } from '../components';
import { useApi } from '../hooks';

const categories = ['فنادق شرم الشيخ', 'عمال إنتاج بالمصانع', 'وظائف الغردقة', 'أفراد أمن', 'كول سنتر'];

export function JobsPage() {
  const state = useApi<any>('/jobs');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const vacationSystem = [1, 2, 3].map((index) => ({
      label: optional(form, `vacation${index}Label`), workDays: optionalNumber(form, `vacation${index}Work`),
      leaveDays: optionalNumber(form, `vacation${index}Leave`), notes: optional(form, `vacation${index}Notes`),
    })).filter((period) => period.label && period.workDays !== undefined && period.leaveDays !== undefined);
    try {
      const job = await mutate<any>('/jobs', 'POST', {
        category: form.get('category'), title: form.get('title'), company: optional(form, 'company'), city: form.get('city'), area: optional(form, 'area'),
        salaryMin: optionalNumber(form, 'salaryMin'), salaryMax: optionalNumber(form, 'salaryMax'), salaryCurrency: form.get('salaryCurrency'),
        employmentType: optional(form, 'employmentType'), experience: optional(form, 'experience'), gender: optional(form, 'gender'),
        ageMin: optionalNumber(form, 'ageMin'), ageMax: optionalNumber(form, 'ageMax'), qualification: optional(form, 'qualification'), minimumEducation: optional(form, 'minimumEducation'),
        heightMinCm: optionalNumber(form, 'heightMinCm'), heightMaxCm: optionalNumber(form, 'heightMaxCm'), description: optional(form, 'description'), requirements: optional(form, 'requirements'),
        vacationSystem, conditions: lines(form, 'conditions'), benefitsList: lines(form, 'benefitsList'), requiredDocuments: lines(form, 'requiredDocuments'), freeCourses: lines(form, 'freeCourses'),
        drugTestRequired: checked(form, 'drugTestRequired'), securityCheckRequired: checked(form, 'securityCheckRequired'), firstTravelPayer: optional(form, 'firstTravelPayer'),
        travelCostMin: optionalNumber(form, 'travelCostMin'), travelCostMax: optionalNumber(form, 'travelCostMax'), housingProvided: checked(form, 'housingProvided'), mealsPerDay: optionalNumber(form, 'mealsPerDay'),
        promotionAfterMonths: optionalNumber(form, 'promotionAfterMonths'), sameDayTravel: checked(form, 'sameDayTravel'), contractFromFirstDay: checked(form, 'contractFromFirstDay'),
        healthInsurance: checked(form, 'healthInsurance'), socialInsurance: checked(form, 'socialInsurance'), notes: optional(form, 'notes'), contactMethod: optional(form, 'contactMethod'),
        whatsapp: optional(form, 'whatsapp'), phone: optional(form, 'phone'), email: optional(form, 'email'), applyLink: optional(form, 'applyLink'), finalText: form.get('finalText'),
        targeting: { locations: [String(form.get('city'))], requiredKeywords: lines(form, 'targetKeywords'), minScore: optionalNumber(form, 'minScore'), minMembers: optionalNumber(form, 'minMembers'), includeGroupIds: [], excludeGroupIds: [] },
      });
      const image = form.get('image');
      if (image instanceof File && image.size) { const upload = new FormData(); upload.set('image', image); await api(`/jobs/${job.id}/image`, { method: 'POST', body: upload }); }
      formElement.reset(); setShow(false); await state.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  if (state.loading) return <Loading/>;
  return <>
    <PageHeader title="الوظائف والحملات" description="سجّل بيانات الوظيفة ومحتوى المنشور الذي سيُنشر كما كتبته." actions={<button className="btn-primary" onClick={() => setShow(!show)}><Plus size={17}/>إضافة وظيفة جديدة</button>}/>
    {error && <ErrorBox message={error}/>} 
    {show && <form onSubmit={create} className="mb-6 space-y-5">
      <Section title="البيانات الأساسية">
        <label><span className="label">التصنيف</span><select className="input" name="category" required>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <Field name="title" label="اسم الوظيفة" placeholder="مثال: وايتر مطاعم"/><Field name="city" label="مدينة العمل" placeholder="مثال: شرم الشيخ"/>
        <Field name="area" label="المنطقة (اختياري)" required={false}/><Field name="company" label="الشركة أو الفندق (اختياري)" required={false}/>
        <label><span className="label">نوع الدوام (اختياري)</span><select className="input" name="employmentType"><option value="">غير محدد</option><option value="FULL_TIME">دوام كامل</option><option value="PART_TIME">دوام جزئي</option></select></label>
        <Field name="experience" label="الخبرة (اختياري)" required={false}/><Field name="gender" label="النوع المطلوب (اختياري)" required={false} placeholder="ذكور / إناث / الكل"/>
      </Section>
      <Section title="السن والراتب والمؤهل والطول">
        <Field name="ageMin" label="السن من" type="number" min="0" required={false}/><Field name="ageMax" label="السن إلى" type="number" min="0" required={false}/>
        <Field name="salaryMin" label="الراتب من" type="number" min="0" required={false}/><Field name="salaryMax" label="الراتب إلى" type="number" min="0" required={false}/>
        <label><span className="label">العملة</span><select className="input" name="salaryCurrency"><option value="EGP">جنيه مصري</option><option value="USD">دولار</option></select></label>
        <Field name="qualification" label="المؤهل" required={false} placeholder="مثال: متوسط"/><Field name="minimumEducation" label="الحد الأدنى للمؤهل" required={false} placeholder="مثال: دبلوم"/>
        <Field name="heightMinCm" label="الطول من (سم)" type="number" min="0" required={false}/><Field name="heightMaxCm" label="الطول إلى (سم)" type="number" min="0" required={false}/>
      </Section>
      <section className="card"><h2 className="mb-4 text-lg font-extrabold">نظام العمل والإجازات</h2><div className="space-y-4"><VacationRow index={1} defaultLabel="الشهر الأول"/><VacationRow index={2} defaultLabel="الشهر الثاني"/><VacationRow index={3} defaultLabel="بعد 6 أشهر"/></div></section>
      <Section title="شروط وتفاصيل السفر">
        <Checks items={[["drugTestRequired", "تحليل مخدرات"], ["securityCheckRequired", "استعلام أمني"], ["housingProvided", "سكن وإقامة متوفرة"], ["sameDayTravel", "سفر في نفس اليوم"], ["contractFromFirstDay", "عقد من أول يوم"], ["healthInsurance", "تأمين صحي من أول يوم"], ["socialInsurance", "تأمين اجتماعي من أول يوم"]]}/>
        <label><span className="label">أول سفر على حساب</span><select className="input" name="firstTravelPayer"><option value="">غير محدد</option><option value="CANDIDATE">المتقدم</option><option value="EMPLOYER">جهة العمل</option></select></label>
        <Field name="travelCostMin" label="تكلفة السفر من" type="number" min="0" required={false}/><Field name="travelCostMax" label="تكلفة السفر إلى" type="number" min="0" required={false}/>
        <Field name="mealsPerDay" label="عدد الوجبات يوميًا" type="number" min="0" required={false}/><Field name="promotionAfterMonths" label="الترقية بعد (شهور)" type="number" min="0" required={false}/>
      </Section>
      <Section title="القوائم التفصيلية">
        <Text name="conditions" label="شروط العمل — شرط في كل سطر" required={false}/><Text name="benefitsList" label="مميزات العمل — ميزة في كل سطر" required={false}/>
        <Text name="requiredDocuments" label="الأوراق المطلوبة — ورقة في كل سطر" required={false} placeholder={'صورة البطاقة\nأصل شهادة الميلاد\nأصل المؤهل\nالموقف من التجنيد\nفيش جنائي\nكعب عمل\nبرنت تأمين\nصور شخصية'}/>
        <Text name="freeCourses" label="الكورسات المجانية — كورس في كل سطر" required={false} placeholder={'إنجليزي\nإيطالي'}/>
        <Text name="description" label="وصف إضافي (اختياري)" required={false}/><Text name="requirements" label="متطلبات إضافية (اختياري)" required={false}/><Text name="notes" label="ملاحظات داخلية لا تُنشر (اختياري)" required={false}/>
      </Section>
      <Section title="التواصل والاستهداف">
        <Field name="contactMethod" label="طريقة التواصل (اختياري)" required={false}/><Field name="phone" label="الهاتف" required={false}/><Field name="whatsapp" label="واتساب" required={false}/><Field name="email" label="البريد" type="email" required={false}/><Field name="applyLink" label="رابط التقديم" type="url" required={false}/>
        <Field name="minScore" label="الحد الأدنى لتقييم الجروب" type="number" min="0" max="100" defaultValue="60" required={false}/><Field name="minMembers" label="الحد الأدنى للأعضاء" type="number" min="1" defaultValue="10000" required={false}/>
        <Text name="targetKeywords" label="كلمات الاستهداف — كلمة في كل سطر" required={false} defaultValue={'وظائف\nتوظيف'}/><label><span className="label">صورة الإعلان (اختياري)</span><input className="input" name="image" type="file" accept="image/png,image/jpeg,image/webp"/></label>
      </Section>
      <section className="card border-2 border-brand-200"><h2 className="text-lg font-extrabold">محتوى المنشور</h2><p className="mb-3 text-sm text-slate-500">هذا النص هو الذي سيُنسخ إلى منشور Facebook كما كتبته.</p><Text name="finalText" label="نص البوست" rows={10}/></section>
      <button className="btn-primary w-full justify-center py-3">حفظ الوظيفة ومحتوى المنشور</button>
    </form>}
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{state.data?.items.map((job: any) => <article className="card" key={job.id}><div className="mb-4 flex items-start justify-between"><div className="rounded-xl bg-blue-50 p-2 text-blue-700"><BriefcaseBusiness/></div><Badge status={job.status}/></div><span className="mb-2 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{job.category}</span><h2 className="text-lg font-extrabold">{job.title}</h2><p className="text-sm text-slate-500">{[job.company, job.city].filter(Boolean).join(' • ')}</p>{(job.salaryMin || job.salaryMax) && <p className="mt-2 font-bold text-emerald-700">{job.salaryMin?.toLocaleString('ar-EG') ?? '—'} – {job.salaryMax?.toLocaleString('ar-EG') ?? '—'} {job.salaryCurrency === 'EGP' ? 'ج.م' : job.salaryCurrency}</p>}<div className="my-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span>المنشورات</span><strong>{job._count.posts}</strong><span>الحملات</span><strong>{job.campaigns.length}</strong></div><JobDetails job={job}/><details className="mb-4 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer font-semibold">معاينة محتوى المنشور</summary><p className="mt-3 whitespace-pre-wrap text-sm">{job.finalText}</p></details><div className="flex gap-2"><Link className="btn-secondary" to={`/jobs/${job.id}/eligible`}>الجروبات المؤهلة</Link>{job.campaigns[0] && <Link className="btn-primary" to={`/campaigns/${job.campaigns[0].id}`}>التقرير</Link>}</div></article>)}</div>
  </>;
}

const optional = (form: FormData, name: string) => String(form.get(name) ?? '').trim() || undefined;
const optionalNumber = (form: FormData, name: string) => { const value = optional(form, name); return value === undefined ? undefined : Number(value); };
const lines = (form: FormData, name: string) => String(form.get(name) ?? '').split(/\r?\n|،|,/).map((value) => value.trim()).filter(Boolean);
const checked = (form: FormData, name: string) => form.get(name) === 'on';
function Field({ label, required = true, ...props }: any) { return <label><span className="label">{label}</span><input className="input" {...props} required={required}/></label>; }
function Text({ label, rows = 4, required = true, ...props }: any) { return <label className="md:col-span-2"><span className="label">{label}</span><textarea className="input" rows={rows} {...props} required={required}/></label>; }
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="card"><h2 className="mb-4 text-lg font-extrabold">{title}</h2><div className="grid gap-4 md:grid-cols-2">{children}</div></section>; }
function VacationRow({ index, defaultLabel }: { index: number; defaultLabel: string }) { return <div className="grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-4"><Field name={`vacation${index}Label`} label="الفترة" defaultValue={defaultLabel} required={false}/><Field name={`vacation${index}Work`} label="أيام العمل" type="number" min="0" required={false}/><Field name={`vacation${index}Leave`} label="أيام الإجازة" type="number" min="0" required={false}/><Field name={`vacation${index}Notes`} label="ملاحظة" required={false}/></div>; }
function Checks({ items }: { items: [string, string][] }) { return <div className="grid gap-2 md:col-span-2 sm:grid-cols-2 lg:grid-cols-4">{items.map(([name, label]) => <label className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold" key={name}><input type="checkbox" name={name}/>{label}</label>)}</div>; }
function JobDetails({ job }: { job: any }) {
  const flags = [[job.drugTestRequired, 'تحليل مخدرات'], [job.securityCheckRequired, 'استعلام أمني'], [job.housingProvided, 'سكن وإقامة'], [job.contractFromFirstDay, 'عقد من أول يوم'], [job.healthInsurance, 'تأمين صحي'], [job.socialInsurance, 'تأمين اجتماعي']].filter(([enabled]) => enabled).map(([, label]) => label);
  return <details className="mb-3 rounded-xl bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-semibold">بيانات الوظيفة كاملة</summary><div className="mt-3 space-y-2">
    {(job.ageMin || job.ageMax) && <p><strong>السن:</strong> {job.ageMin ?? '—'} إلى {job.ageMax ?? '—'}</p>}
    {(job.qualification || job.minimumEducation) && <p><strong>المؤهل:</strong> {job.qualification ?? '—'} {job.minimumEducation ? `(الحد الأدنى: ${job.minimumEducation})` : ''}</p>}
    {(job.heightMinCm || job.heightMaxCm) && <p><strong>الطول:</strong> {job.heightMinCm ?? '—'} إلى {job.heightMaxCm ?? '—'} سم</p>}
    {!!job.vacationSystem?.length && <div><strong>العمل والإجازات:</strong><ul className="mt-1 list-inside list-disc">{job.vacationSystem.map((period: any, index: number) => <li key={index}>{period.label}: {period.workDays} عمل / {period.leaveDays} إجازة</li>)}</ul></div>}
    {!!flags.length && <p><strong>المزايا والشروط:</strong> {flags.join('، ')}</p>}
    {!!job.benefitsList?.length && <p><strong>المميزات:</strong> {job.benefitsList.join('، ')}</p>}
    {!!job.requiredDocuments?.length && <p><strong>الأوراق:</strong> {job.requiredDocuments.join('، ')}</p>}
  </div></details>;
}
