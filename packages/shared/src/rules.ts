import type { GroupMetrics, GroupRules } from './types.js';

export interface GroupRuleInput {
  metrics: GroupMetrics;
  score: number;
  privacy?: string | null;
  name: string;
  description?: string | null;
  location?: string | null;
}

const includesAny = (text: string, values: string[]) => values.some((value) => text.includes(value.toLocaleLowerCase()));

export function evaluateGroupRules(input: GroupRuleInput, rules: GroupRules) {
  const failures: string[] = [];
  const evidence: string[] = [];
  if (rules.minMembers != null) {
    if (input.metrics.members == null) failures.push('عدد الأعضاء غير متاح للتحقق من الحد الأدنى.');
    else if (input.metrics.members < rules.minMembers) failures.push(`عدد الأعضاء ${input.metrics.members.toLocaleString('ar-EG')} أقل من الحد ${rules.minMembers.toLocaleString('ar-EG')}.`);
    else evidence.push(`عدد الأعضاء يحقق الحد الأدنى (${input.metrics.members.toLocaleString('ar-EG')}).`);
  }
  if (rules.maxMembers != null && input.metrics.members != null && input.metrics.members > rules.maxMembers) failures.push('عدد الأعضاء أكبر من الحد الأقصى.');
  if (rules.minActivity != null) {
    if (input.metrics.activity == null) failures.push('معدل النشاط غير متاح للتحقق من الحد الأدنى.');
    else if (input.metrics.activity < rules.minActivity) failures.push(`النشاط ${input.metrics.activity} منشور/يوم أقل من الحد ${rules.minActivity}.`);
  }
  if (input.score < rules.minScore) failures.push(`التقييم ${input.score} أقل من الحد ${rules.minScore}.`);
  if (input.privacy && rules.allowedPrivacy.length && !rules.allowedPrivacy.includes(input.privacy)) failures.push(`نوع الجروب ${input.privacy} غير مسموح.`);

  const text = `${input.name} ${input.description ?? ''}`.toLocaleLowerCase();
  if (includesAny(text, rules.blockedKeywords.map((v) => v.toLocaleLowerCase()))) failures.push('اسم أو وصف الجروب يحتوي كلمة محظورة.');
  if (rules.requireJobKeywords && !includesAny(text, rules.allowedKeywords.map((v) => v.toLocaleLowerCase()))) failures.push('لا توجد كلمة مرتبطة بالوظائف في اسم أو وصف الجروب.');
  const location = (input.location ?? '').toLocaleLowerCase();
  if (rules.allowedLocations.length && !location) failures.push('الموقع غير متاح للتحقق من المواقع المسموحة.');
  if (location && rules.allowedLocations.length && !includesAny(location, rules.allowedLocations.map((v) => v.toLocaleLowerCase()))) failures.push('موقع الجروب خارج المواقع المسموحة.');
  if (location && includesAny(location, rules.blockedLocations.map((v) => v.toLocaleLowerCase()))) failures.push('موقع الجروب محظور.');
  return { accepted: failures.length === 0, failures, evidence };
}
