import { describe, it, expect } from 'vitest';
import { cleanEntityName } from '@/lib/ecosystem-alert-parser';

describe('cleanEntityName', () => {
  it('strips a trailing DESCRIPTIVE parenthetical (the news-ticker bug)', () => {
    expect(cleanEntityName('Commercialista (incumbent non-software competitor)')).toBe('Commercialista');
    expect(cleanEntityName('Acme (the dominant SMB market leader)')).toBe('Acme');
  });

  it('KEEPS a short parent-brand parenthetical', () => {
    expect(cleanEntityName('Fatture in Cloud (TeamSystem)')).toBe('Fatture in Cloud (TeamSystem)');
    expect(cleanEntityName('QuickBooks (Intuit)')).toBe('QuickBooks (Intuit)');
    expect(cleanEntityName('Danea Easyfatt (TeamSystem group)')).toBe('Danea Easyfatt (TeamSystem group)');
  });

  it('passes a clean name through + trims', () => {
    expect(cleanEntityName('  Xero ')).toBe('Xero');
    expect(cleanEntityName('Zucchetti')).toBe('Zucchetti');
  });

  it('handles empty + caps to 80 chars', () => {
    expect(cleanEntityName('')).toBe('');
    expect(cleanEntityName('x'.repeat(120)).length).toBe(80);
  });
});
