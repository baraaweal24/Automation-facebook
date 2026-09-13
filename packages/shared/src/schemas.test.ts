import { describe, expect, it } from 'vitest';
import { jobCreateSchema, keywordCreateSchema, renderTemplate } from './schemas.js';

describe('contracts and templates', () => {
  it('rejects short keywords', () => expect(() => keywordCreateSchema.parse({ keyword: 'x' })).toThrow());
  it('renders known variables and safely marks absent ones', () => expect(renderTemplate('{{job_title}} - {{salary}}', { job_title: 'خدمة عملاء' })).toBe('خدمة عملاء - —'));
  it('accepts structured job details and vacation periods', () => {
    const job = jobCreateSchema.parse({
      category: 'فنادق شرم الشيخ', title: 'وايتر مطاعم', city: 'شرم الشيخ', ageMin: 20, ageMax: 27,
      salaryMin: 7500, salaryMax: 8000, qualification: 'متوسط', minimumEducation: 'دبلوم',
      vacationSystem: [{ label: 'الشهر الأول', workDays: 25, leaveDays: 5 }],
      requiredDocuments: ['صورة البطاقة', 'أصل شهادة الميلاد'], finalText: 'مطلوب وايتر للعمل في شرم الشيخ فورًا',
    });
    expect(job.vacationSystem[0]).toMatchObject({ workDays: 25, leaveDays: 5 });
    expect(job.requiredDocuments).toHaveLength(2);
  });
  it('rejects reversed age and salary ranges', () => expect(() => jobCreateSchema.parse({
    category: 'أفراد أمن', title: 'فرد أمن', city: 'القاهرة', ageMin: 35, ageMax: 20, salaryMin: 9000, salaryMax: 7000,
    finalText: 'مطلوب فرد أمن للعمل بدوام كامل فورًا',
  })).toThrow());
});
