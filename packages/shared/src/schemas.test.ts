import { describe, expect, it } from 'vitest';
import { keywordCreateSchema, renderTemplate } from './schemas.js';

describe('contracts and templates', () => {
  it('rejects short keywords', () => expect(() => keywordCreateSchema.parse({ keyword: 'x' })).toThrow());
  it('renders known variables and safely marks absent ones', () => expect(renderTemplate('{{job_title}} - {{salary}}', { job_title: 'خدمة عملاء' })).toBe('خدمة عملاء - —'));
});
