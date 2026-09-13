# منصة إدارة ونشر الوظائف في جروبات Facebook

تطبيق محلي عربي RTL مبني بـExpress 5 وReact لإدارة اكتشاف الجروبات وتحليلها، طلبات الانضمام، الوظائف، حملات النشر والمتابعة. يعمل في `DRY_RUN` افتراضيًا ولا يتجاوز CAPTCHA أو 2FA أو فحوصات Facebook الأمنية.

> تنبيه: أتمتة واجهة Facebook ليست API رسمية وقد تؤدي إلى تقييد الحساب. استخدم حسابًا مخولًا، راجع شروط Meta وقواعد كل جروب، ولا تستخدم النظام لإرسال محتوى عشوائي أو غير مرغوب.

## المتطلبات

- Windows 10/11 وNode.js 22+ وGit.
- اتصال إنترنت لتثبيت الحزم وChromium.
- لا يلزم Redis أو Docker؛ SQLite مدمجة.

## الإعداد الأول

نفّذ من PowerShell داخل مجلد المشروع:

```powershell
Copy-Item .env.example .env
# عدّل SESSION_SECRET في .env إلى قيمة عشوائية طويلة
corepack pnpm install
$env:DATABASE_URL='file:D:/Automation facebook/data/app.db'
corepack pnpm run setup
corepack pnpm admin:create
corepack pnpm browser:install
```

إذا سمح Windows بإنشاء Corepack shims يمكنك استخدام `pnpm` مباشرة. عند ظهور `EPERM` استخدم `corepack pnpm` كما في الأمثلة. عنوان SQLite يُقرأ من `.env` عند التشغيل؛ تعيينه في الجلسة أعلاه مطلوب فقط إن لم تكن أداة التشغيل تحمّل `.env`.

`db:seed` يضيف الإعدادات والقوالب فقط. بيانات العرض لا تُضاف إلا بأمر `corepack pnpm db:seed:demo` ومع `NODE_ENV` غير production.

## التشغيل

```powershell
corepack pnpm dev
```

- Dashboard: http://localhost:5173
- API health: http://127.0.0.1:3000/api/health
- OpenAPI: http://127.0.0.1:3000/api/docs
- تبدأ الأتمتة بحالة `STOPPED`. سجّل الدخول ثم افتح صفحة «إعدادات فيسبوك».
- اضغط «فتح جلسة فيسبوك»، وسجّل الدخول يدويًا في Chromium، ثم أغلق الجلسة من اللوحة لتسليم profile إلى Worker.
- أبقِ `DRY_RUN=true` حتى تتأكد من البحث والتحليل والاستهداف. تحويله إلى `false` يحتاج إعادة تشغيل العمليات.

لا تفتح Chromium العادي على مجلد `data/browser-profile` بالتزامن مع التطبيق؛ lock الملف يمنع تلف الجلسة.

## أوامر الصيانة

```powershell
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

قاعدة البيانات في `data/app.db`، وملف المتصفح والصور ولقطات الأخطاء تحت `data/`. هذه الملفات مستبعدة من Git. خذ نسخة احتياطية من مجلد `data` بعد إيقاف API والـWorker.

## التعامل مع التحقق اليدوي

عند CAPTCHA أو انتهاء الجلسة أو Security Check، تتحول المهمة إلى `MANUAL_ACTION_REQUIRED` وتتوقف بوابة الأتمتة. افتح جلسة Facebook من اللوحة وأكمل التحقق بنفسك، أغلق نافذة الجلسة، ثم استأنف الأتمتة. لا توجد آلية stealth أو تجاوز أو إجابات عضوية مختلقة.

## حدود التكامل والاختبار الحي

تغيّر Meta واجهة Facebook باستمرار. الـselectors معزولة في `packages/facebook-automation/src/selectors.ts` وتستخدم roles وlabels باللغتين، لكن يجب اختبار البحث والانضمام والنشر يدويًا على الحساب والواجهة الفعليين قبل تعطيل DRY RUN. الاختبارات الافتراضية لا تتصل بـFacebook.

## البناء للإنتاج المحلي

```powershell
corepack pnpm build
corepack pnpm --filter @app/api start
corepack pnpm --filter @app/worker start
corepack pnpm --filter @app/dashboard exec vite preview --host 127.0.0.1
```

استخدم HTTPS عبر reverse proxy إذا أصبحت اللوحة متاحة خارج الجهاز، واضبط `DASHBOARD_ORIGIN` و`SESSION_SECRET` وملف `.env` قبل التشغيل.
