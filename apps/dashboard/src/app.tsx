import { ContentStudioPage } from './pages/content-studio';
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { api, setCsrf } from './api';
import { Loading } from './components';
import { Layout } from './layout';
import { ActivityPage, ErrorsPage, NotificationsPage, PostsPage, TasksPage } from './pages/operations';
import { CampaignPage } from './pages/campaign';
import { DashboardPage } from './pages/dashboard';
import { EligibleGroupsPage } from './pages/eligible';
import { FacebookPage } from './pages/facebook';
import { GroupDetailPage } from './pages/group-detail';
import { GroupsPage } from './pages/groups';
import { JobsPage } from './pages/jobs';
import { KeywordsPage } from './pages/keywords';
import { LoginPage } from './pages/login';
import { QuestionsPage } from './pages/questions';
import { SettingsPage } from './pages/settings';

export function App() { const [auth, setAuth] = useState<'loading' | 'yes' | 'no'>('loading'); const check = async () => { try { const result = await api<{ csrfToken: string }>('/auth/me'); setCsrf(result.csrfToken); setAuth('yes'); } catch { setAuth('no'); } }; useEffect(() => { void check(); }, []); if (auth === 'loading') return <Loading/>; if (auth === 'no') return <LoginPage onLogin={() => setAuth('yes')}/>; return <BrowserRouter><Routes><Route element={<Layout/>}><Route index element={<DashboardPage/>}/><Route path="content" element={<ContentStudioPage/>}/><Route path="groups" element={<GroupsPage/>}/><Route path="groups/:id" element={<GroupDetailPage/>}/><Route path="keywords" element={<KeywordsPage/>}/><Route path="questions" element={<QuestionsPage/>}/><Route path="jobs" element={<JobsPage/>}/><Route path="jobs/:id/eligible" element={<EligibleGroupsPage/>}/><Route path="campaigns/:id" element={<CampaignPage/>}/><Route path="posts" element={<PostsPage/>}/><Route path="tasks" element={<TasksPage/>}/><Route path="errors" element={<ErrorsPage/>}/><Route path="notifications" element={<NotificationsPage/>}/><Route path="activity" element={<ActivityPage/>}/><Route path="facebook" element={<FacebookPage/>}/><Route path="settings" element={<SettingsPage/>}/></Route></Routes></BrowserRouter>; }
