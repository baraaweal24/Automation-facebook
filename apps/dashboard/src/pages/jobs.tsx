import { FormEvent, useState } from 'react';
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, mutate } from '../api';
import { Badge, ErrorBox, Loading, PageHeader } from '../components';
import { useApi } from '../hooks';

export function JobsPage() {
  const state = useApi<any>('/jobs');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const job = await mutate<any>('/jobs', 'POST', {
        title: form.get('title'), company: form.get('company'), city: form.get('city'), area: optional(form, 'area'), salary: optional(form, 'salary'),
        employmentType: form.get('employmentType'), experience: optional(form, 'experience'), description: form.get('description'), requirements: form.get('requirements'), benefits: optional(form, 'benefits'),
        contactMethod: form.get('contactMethod'), whatsapp: optional(form, 'whatsapp'), phone: optional(form, 'phone'), email: optional(form, 'email'), applyLink: optional(form, 'applyLink'), finalText: form.get('finalText'),
        targeting: { locations: [String(form.get('city'))], requiredKeywords: split(String(form.get('targetKeywords'))), minScore: Number(form.get('minScore')), minMembers: Number(form.get('minMembers')), includeGroupIds: [], excludeGroupIds: [] },
      });
      const image = form.get('image');
      if (image instanceof File && image.size) { const upload = new FormData(); upload.set('image', image); await api(`/jobs/${job.id}/image`, { method: 'POST', body: upload }); }
      setShow(false); await state.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  if (state.loading) return <Loading/>;
  return <>
    <PageHeader title="الوظائف والحملات" description="أنشئ إعلانًا وحدد شروط الجروبات ثم راجع المؤهل منها." actions={<button className="btn-primary" onClick={() => setShow(!show)}><Plus size={17}/>وظيفة جديدة</button>}/>
    {error && <ErrorBox message={error}/>} 
    {show && <form onSubmit={create} className="card mb-5 grid gap-4 md:grid-cols-2">
      <Field name="title" label="اسم الوظيفة"/><Field name="company" label="الشركة"/><Field name="city" label="المدينة"/><Field name="area" label="المنطقة (اختياري)" required={false}/>
      <Field name="salary" label="الراتب (اختياري)" required={false}/><Field name="experience" label="الخبرة (اختياري)" required={false}/>
      <label><span className="label">نوع الدوام</span><select className="input" name="employmentType"><option value="FULL_TIME">دوام كامل</option><option value="PART_TIME">دوام جزئي</option></select></label>
      <Field name="contactMethod" label="طريقة التواصل"/><Field name="phone" label="الهاتف" required={false}/><Field name="whatsapp" label="واتساب" required={false}/><Field name="email" label="البريد" type="email" required={false}/><Field name="applyLink" label="رابط التقديم" type="url" required={false}/>
      <Field name="minScore" label="الحد الأدنى للتقييم" type="number" defaultValue="60"/><Field name="minMembers" label="الحد الأدنى للأعضاء" type="number" defaultValue="10000"/>
      <Field name="targetKeywords" label="كلمات الاستهداف (افصل بفاصلة)" defaultValue="وظائف، توظيف"/>
      <label><span className="label">صورة الإعلان (اختياري)</span><input className="input" name="image" type="file" accept="image/png,image/jpeg,image/webp"/></label>
      <Text name="description" label="الوصف"/><Text name="requirements" label="المتطلبات"/><Text name="benefits" label="المميزات (اختياري)" required={false}/><Text name="finalText" label="نص الإعلان النهائي" rows={7}/>
      <button className="btn-primary md:col-span-2">حفظ الوظيفة</button>
    </form>}
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{state.data?.items.map((job: any) => <article className="card" key={job.id}><div className="mb-4 flex items-start justify-between"><div className="rounded-xl bg-blue-50 p-2 text-blue-700"><BriefcaseBusiness/></div><Badge status={job.status}/></div><h2 className="text-lg font-extrabold">{job.title}</h2><p className="text-sm text-slate-500">{job.company} • {job.city}</p><div className="my-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span>المنشورات</span><strong>{job._count.posts}</strong><span>الحملات</span><strong>{job.campaigns.length}</strong></div><div className="flex gap-2"><Link className="btn-secondary" to={`/jobs/${job.id}/eligible`}>الجروبات المؤهلة</Link>{job.campaigns[0] && <Link className="btn-primary" to={`/campaigns/${job.campaigns[0].id}`}>التقرير</Link>}</div></article>)}</div>
  </>;
}

const optional = (form: FormData, name: string) => String(form.get(name) ?? '').trim() || undefined;
const split = (value: string) => value.split(/[،,]/).map((v) => v.trim()).filter(Boolean);
function Field({ label, required = true, ...props }: any) { return <label><span className="label">{label}</span><input className="input" {...props} required={required}/></label>; }
function Text({ label, rows = 3, required = true, ...props }: any) { return <label className="md:col-span-2"><span className="label">{label}</span><textarea className="input" rows={rows} {...props} required={required}/></label>; }
