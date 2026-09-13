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

export function renderTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key]?.trim() || '—');
}
