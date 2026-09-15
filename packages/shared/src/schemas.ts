import { z } from 'zod';

export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional() });
export const keywordCreateSchema = z.object({ keyword: z.string().trim().min(2).max(120), priority: z.number().int().min(-100).max(100).default(0), isActive: z.boolean().default(true) });
export const keywordUpdateSchema = keywordCreateSchema.partial();
export const loginSchema = z.object({ login: z.string().trim().min(2), password: z.string().min(10).max(200) });

export const JOB_CATEGORIES = [
  'فنادق شرم الشيخ',
  'عمال إنتاج بالمصانع',
  'وظائف الغردقة',
  'أفراد أمن',
  'كول سنتر',
  'محتوى عام',
] as const;

const optionalText = z.string().trim().optional().or(z.literal(''));
const optionalInteger = z.number().int().nonnegative().optional();
const vacationPeriodSchema = z.object({
  label: z.string().trim().min(2),
  workDays: z.number().int().nonnegative(),
  leaveDays: z.number().int().nonnegative(),
  notes: optionalText,
});

export const jobCreateSchema = z.object({
  category: z.enum(JOB_CATEGORIES), title: z.string().trim().min(2), company: optionalText, city: z.string().trim().min(2), area: optionalText,
  salary: optionalText, salaryMin: optionalInteger, salaryMax: optionalInteger, salaryCurrency: z.string().trim().min(2).default('EGP'),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME']).optional(), experience: optionalText, gender: optionalText, ageRange: optionalText,
  ageMin: optionalInteger, ageMax: optionalInteger, qualification: optionalText, minimumEducation: optionalText,
  heightMinCm: optionalInteger, heightMaxCm: optionalInteger, description: optionalText, requirements: optionalText, benefits: optionalText,
  vacationSystem: z.array(vacationPeriodSchema).default([]), conditions: z.array(z.string().trim().min(1)).default([]),
  benefitsList: z.array(z.string().trim().min(1)).default([]), requiredDocuments: z.array(z.string().trim().min(1)).default([]), freeCourses: z.array(z.string().trim().min(1)).default([]),
  drugTestRequired: z.boolean().default(false), securityCheckRequired: z.boolean().default(false), firstTravelPayer: optionalText,
  travelCostMin: optionalInteger, travelCostMax: optionalInteger, housingProvided: z.boolean().default(false), mealsPerDay: optionalInteger,
  promotionAfterMonths: optionalInteger, sameDayTravel: z.boolean().default(false), contractFromFirstDay: z.boolean().default(false),
  healthInsurance: z.boolean().default(false), socialInsurance: z.boolean().default(false), notes: optionalText, contactMethod: optionalText,
  whatsapp: optionalText, phone: optionalText, email: z.email().optional().or(z.literal('')), applyLink: z.url().optional().or(z.literal('')),
  finalText: z.string().min(10), targeting: z.object({ locations: z.array(z.string()).default([]), requiredKeywords: z.array(z.string()).default([]), minScore: z.number().min(0).max(100).optional(), minMembers: z.number().int().positive().optional(), includeGroupIds: z.array(z.string()).default([]), excludeGroupIds: z.array(z.string()).default([]) }).optional(),
}).superRefine((job, context) => {
  if (job.ageMin !== undefined && job.ageMax !== undefined && job.ageMin > job.ageMax) context.addIssue({ code: 'custom', path: ['ageMax'], message: 'الحد الأقصى للسن يجب أن يكون أكبر من الحد الأدنى.' });
  if (job.salaryMin !== undefined && job.salaryMax !== undefined && job.salaryMin > job.salaryMax) context.addIssue({ code: 'custom', path: ['salaryMax'], message: 'الحد الأقصى للراتب يجب أن يكون أكبر من الحد الأدنى.' });
  if (job.heightMinCm !== undefined && job.heightMaxCm !== undefined && job.heightMinCm > job.heightMaxCm) context.addIssue({ code: 'custom', path: ['heightMaxCm'], message: 'الحد الأقصى للطول يجب أن يكون أكبر من الحد الأدنى.' });
});
export const answersSchema = z.object({ answers: z.array(z.object({ questionId: z.string().min(1), value: z.union([z.string(), z.boolean(), z.array(z.string())]) })).min(1) });

const names = z.array(z.string().trim().min(1).max(200)).max(200);
const optionalLimit = z.number().nonnegative().nullable().optional();
export const groupRulesSchema = z.object({
  minMembers: optionalLimit, maxMembers: optionalLimit, minActivity: optionalLimit,
  minScore: z.number().min(0).max(100), allowedPrivacy: z.array(z.enum(['PUBLIC', 'PRIVATE'])),
  requireJobKeywords: z.boolean(), allowedKeywords: names, blockedKeywords: names,
  allowedLocations: names, blockedLocations: names,
}).strict().refine(v => v.minMembers == null || v.maxMembers == null || v.maxMembers >= v.minMembers, 'الحد الأقصى للأعضاء أقل من الحد الأدنى.');
const weight = z.number().min(0).max(100);
export const scoreWeightsSchema = z.object({ members: weight, activity: weight, engagement: weight, keywordRelevance: weight, locationRelevance: weight }).strict().refine(v => Math.abs(Object.values(v).reduce((a,b) => a+b,0) - 100) < 0.01, 'مجموع الأوزان يجب أن يساوي 100.');
export const automationSettingsSchema = z.object({
  browserHeadless: z.boolean().optional(), autoStartWorkers: z.literal(false).optional(), browserConcurrency: z.literal(1).optional(),
  maxGroupsPerSearch: z.number().int().min(1).max(1000), maxGroupsToAnalyzePerRun: z.number().int().min(1).max(1000),
  maxJoinAttempts: z.number().int().min(1).max(10), maxPostsPerRun: z.number().int().min(1).max(100),
  actionDelayMs: z.number().int().min(1000).max(3600000), pageTimeoutMs: z.number().int().min(5000).max(180000),
  retryCount: z.number().int().min(1).max(10), pendingJoinRecheckMinutes: z.number().min(1).max(10080),
  pendingPostRecheckMinutes: z.number().min(1).max(10080), screenshotOnError: z.boolean(),
}).strict();
export const settingsSchema = z.object({ globalGroupRules: groupRulesSchema.optional(), scoreWeights: scoreWeightsSchema.optional(), automationSettings: automationSettingsSchema.optional() }).strict();
export const publishSchema = z.object({
  groupIds: z.array(z.string().min(1)).min(1).max(1000).transform(v => [...new Set(v)]),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  requestKey: z.string().uuid(), reviewed: z.literal(true),
});
export const contentDraftSchema = z.object({
  title: z.string().trim().min(2).max(200), sourceData: z.string().trim().min(10).max(20000),
  instructions: z.string().trim().max(2000).default(''), groupIds: z.array(z.string().min(1)).min(1).max(1000),
  finalText: z.string().max(20000).default(''),
});
export const postDecisionSchema = z.object({
  status: z.enum(['POSTED', 'APPROVED', 'PENDING_ADMIN_APPROVAL', 'REJECTED', 'SKIPPED', 'QUEUED']),
  reason: z.string().trim().min(5).max(1000), facebookUrl: z.url().optional(),
  confirmedAbsent: z.boolean().optional(),
});

export function renderTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key]?.trim() || '—');
}
