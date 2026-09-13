import { z } from 'zod';

export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional() });
export const keywordCreateSchema = z.object({ keyword: z.string().trim().min(2).max(120), priority: z.number().int().min(-100).max(100).default(0), isActive: z.boolean().default(true) });
export const keywordUpdateSchema = keywordCreateSchema.partial();
export const loginSchema = z.object({ login: z.string().trim().min(2), password: z.string().min(10).max(200) });
export const jobCreateSchema = z.object({
  title: z.string().min(2), company: z.string().min(2), city: z.string().min(2), area: z.string().optional(), salary: z.string().optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME']), experience: z.string().optional(), gender: z.string().optional(), ageRange: z.string().optional(),
  description: z.string().min(10), requirements: z.string().min(2), benefits: z.string().optional(), contactMethod: z.string().min(2),
  whatsapp: z.string().optional(), phone: z.string().optional(), email: z.email().optional().or(z.literal('')), applyLink: z.url().optional().or(z.literal('')),
  finalText: z.string().min(10), targeting: z.object({ locations: z.array(z.string()).default([]), requiredKeywords: z.array(z.string()).default([]), minScore: z.number().min(0).max(100).optional(), minMembers: z.number().int().positive().optional(), includeGroupIds: z.array(z.string()).default([]), excludeGroupIds: z.array(z.string()).default([]) }).optional(),
});
export const answersSchema = z.object({ answers: z.array(z.object({ questionId: z.string().min(1), value: z.union([z.string(), z.boolean(), z.array(z.string())]) })).min(1) });

export function renderTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key]?.trim() || '—');
}
