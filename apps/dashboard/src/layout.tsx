import { Activity, Bell, Bot, BriefcaseBusiness, Bug, ChevronLeft, CircleGauge, Facebook, FileQuestion, FileText, ListChecks, Menu, Settings, Tags, Users, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { mutate } from './api';
import { useApi } from './hooks';

const nav = [
  ['/', 'لوحة التحكم', CircleGauge], ['/content', 'استوديو المحتوى', FileText], ['/groups', 'الجروبات', Users], ['/keywords', 'كلمات البحث', Tags], ['/questions', 'أسئلة الانضمام', FileQuestion], ['/jobs', 'الوظائف والحملات', BriefcaseBusiness], ['/posts', 'المنشورات', FileText], ['/tasks', 'قائمة الانتظار', ListChecks], ['/errors', 'الأخطاء', Bug], ['/notifications', 'التنبيهات', Bell], ['/activity', 'سجل النشاط', Activity], ['/facebook', 'إعدادات فيسبوك', Facebook], ['/settings', 'إعدادات النظام', Settings],
] as const;

export function Layout() {
  const [open, setOpen] = useState(false);
  const status = useApi<{ state: string; dryRun: boolean }>('/automation/status');
  const action = async (name: string) => { await mutate(`/automation/${name}`, 'POST'); await status.refresh(); };
  return <div className="min-h-screen">
    <aside className={`fixed inset-y-0 right-0 z-40 w-72 bg-ink text-white transition-transform lg:translate-x-0 ${open ? 'block' : 'hidden lg:block'}`}>
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-6"><div><div className="text-lg font-extrabold">مرصد الوظائف</div><div className="text-xs text-white/50">Facebook Operations</div></div><button className="lg:hidden" onClick={() => setOpen(false)}><X /></button></div>
      <nav className="max-h-[calc(100vh-5rem)] space-y-1 overflow-y-auto p-4">{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${isActive ? 'bg-white text-ink' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}><Icon size={19}/><span>{label}</span><ChevronLeft className="mr-auto" size={15}/></NavLink>)}</nav>
    </aside>
    <div className="lg:mr-72">
      <header className="sticky top-0 z-30 flex min-h-20 flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:py-0 md:px-8"><button className="btn-secondary p-2 lg:hidden" onClick={() => setOpen(true)}><Menu size={20}/></button>{status.data?.dryRun && <span className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-extrabold text-violet-700">وضع الاختبار DRY RUN</span>}<div className="mr-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto"><span className="text-xs text-slate-500">الأتمتة</span><span className={`h-2.5 w-2.5 rounded-full ${status.data?.state === 'RUNNING' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}/><strong className="text-sm">{status.data?.state ?? '...'}</strong><button className="btn-secondary px-3 py-2" onClick={() => action(status.data?.state === 'RUNNING' ? 'pause' : 'start')}><Bot size={16}/>{status.data?.state === 'RUNNING' ? 'إيقاف مؤقت' : 'تشغيل'}</button><button className="btn bg-rose-600 px-3 py-2 text-white hover:bg-rose-700" onClick={() => action('emergency')}>إيقاف طارئ</button></div></header>
      <main className="p-4 md:p-8"><Outlet /></main>
    </div>
  </div>;
}
