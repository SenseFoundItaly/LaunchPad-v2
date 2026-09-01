import { describe, it, expect } from 'vitest';
import {
  parseIsoDeadline,
  parseItalianDate,
  parseTimeHHMM,
  isFutureDate,
  isTodayOrFuture,
  maxIsoDate,
  extractDeadlineFromHeadline,
  formatDeadlineForLocale,
  toDateOnly,
  isValidCalendarDate,
} from './dates';
import { stripHtml, decodeHtmlEntities, excerpt } from './text';

describe('parseIsoDeadline', () => {
  it('takes the leading calendar date of an ISO-ish string', () => {
    expect(parseIsoDeadline('2027-04-21T00:00:00.000+0000')).toBe('2027-04-21');
    expect(parseIsoDeadline('2026-09-07T00:00:00.000')).toBe('2026-09-07');
    expect(parseIsoDeadline('2026-09-07')).toBe('2026-09-07');
  });

  it('rejects impossible calendar dates', () => {
    expect(parseIsoDeadline('2026-02-30')).toBeNull();
    expect(parseIsoDeadline('2026-13-01')).toBeNull();
    expect(parseIsoDeadline('2026-00-10')).toBeNull();
  });

  it('rejects non-ISO shapes and non-strings', () => {
    expect(parseIsoDeadline('07/09/2026')).toBeNull();
    expect(parseIsoDeadline(undefined)).toBeNull();
    expect(parseIsoDeadline(null)).toBeNull();
    expect(parseIsoDeadline(20260907)).toBeNull();
    expect(parseIsoDeadline('')).toBeNull();
    // date glued to trailing garbage is not a date field
    expect(parseIsoDeadline('2026-09-07x')).toBeNull();
  });
});

describe('parseItalianDate', () => {
  it('converts DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(parseItalianDate('07/09/2026')).toBe('2026-09-07');
    expect(parseItalianDate('  07/09/2026 ')).toBe('2026-09-07');
  });

  it('rejects impossible dates and other shapes', () => {
    expect(parseItalianDate('31/02/2026')).toBeNull();
    expect(parseItalianDate('2026-09-07')).toBeNull();
    expect(parseItalianDate('7/9/2026')).toBeNull();
    expect(parseItalianDate(undefined)).toBeNull();
    expect(parseItalianDate('')).toBeNull();
  });

  it('never swaps day and month (13/01 is 13 January, 01/13 is impossible)', () => {
    expect(parseItalianDate('13/01/2026')).toBe('2026-01-13');
    expect(parseItalianDate('01/13/2026')).toBeNull();
  });
});

describe('parseTimeHHMM', () => {
  it('normalises HH:MM / H:MM / HH.MM', () => {
    expect(parseTimeHHMM('12:00')).toBe('12:00');
    expect(parseTimeHHMM('9:05')).toBe('09:05');
    expect(parseTimeHHMM('16.30')).toBe('16:30');
    expect(parseTimeHHMM(' 17:00 ')).toBe('17:00');
  });

  it('rejects out-of-range and malformed values', () => {
    expect(parseTimeHHMM('24:00')).toBeNull();
    expect(parseTimeHHMM('12:60')).toBeNull();
    expect(parseTimeHHMM('12')).toBeNull();
    expect(parseTimeHHMM('12:0')).toBeNull();
    expect(parseTimeHHMM(undefined)).toBeNull();
  });
});

describe('isFutureDate / isTodayOrFuture', () => {
  it('uses the UTC calendar date of a Date "today"', () => {
    expect(isFutureDate('2026-09-02', new Date('2026-09-01T23:59:59Z'))).toBe(true);
    expect(isFutureDate('2026-09-01', new Date('2026-09-01T00:00:00Z'))).toBe(false);
  });

  it('accepts an IsoDate "today"', () => {
    expect(isTodayOrFuture('2026-09-01', '2026-09-01')).toBe(true);
    expect(isFutureDate('2026-09-01', '2026-09-01')).toBe(false);
    expect(isFutureDate('2026-08-31', '2026-09-01')).toBe(false);
    expect(isTodayOrFuture('2026-08-31', '2026-09-01')).toBe(false);
  });
});

describe('maxIsoDate', () => {
  it('returns the latest, skipping null/undefined', () => {
    expect(maxIsoDate(['2026-03-31', null, '2026-10-20'])).toBe('2026-10-20');
    expect(maxIsoDate(['2026-10-20', undefined, '2026-03-31'])).toBe('2026-10-20');
  });

  it('returns null for an empty or all-null list', () => {
    expect(maxIsoDate([])).toBeNull();
    expect(maxIsoDate([null, undefined])).toBeNull();
  });
});

describe('extractDeadlineFromHeadline', () => {
  it('finds an Italian date and reports the exact snippet', () => {
    expect(extractDeadlineFromHeadline('Bando Tertium — Regione Lombardia, scade il 07/09/2026')).toEqual({
      date: '2026-09-07',
      snippet: '07/09/2026',
    });
  });

  it('finds an ISO date', () => {
    expect(extractDeadlineFromHeadline('IHI Call 13 — deadline 2027-04-21')).toEqual({
      date: '2027-04-21',
      snippet: '2027-04-21',
    });
  });

  it('picks the LATEST when several dates appear', () => {
    const r = extractDeadlineFromHeadline('apre 01/10/2026, chiude 15/12/2026');
    expect(r?.date).toBe('2026-12-15');
    expect(r?.snippet).toBe('15/12/2026');
  });

  it('returns null when there is no date, an impossible date, or only longer digit runs', () => {
    expect(extractDeadlineFromHeadline('EIC Accelerator 2026 — rolling')).toBeNull();
    expect(extractDeadlineFromHeadline('Bando 31/02/2026')).toBeNull();
    expect(extractDeadlineFromHeadline('ref 12345/67/8901')).toBeNull();
    expect(extractDeadlineFromHeadline('')).toBeNull();
  });

  it('skips an impossible date but still returns a valid later one', () => {
    expect(extractDeadlineFromHeadline('31/02/2026 e 15/12/2026')?.date).toBe('2026-12-15');
  });
});

describe('formatDeadlineForLocale', () => {
  it('renders it as DD/MM/YYYY and en as ISO', () => {
    expect(formatDeadlineForLocale('2026-09-07', 'it')).toBe('07/09/2026');
    expect(formatDeadlineForLocale('2026-09-07', 'en')).toBe('2026-09-07');
  });
});

describe('toDateOnly / isValidCalendarDate', () => {
  it('uses the UTC calendar date', () => {
    expect(toDateOnly(new Date('2026-09-01T23:30:00Z'))).toBe('2026-09-01');
    expect(toDateOnly(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31');
  });

  it('validates leap days and the supported year window', () => {
    expect(isValidCalendarDate(2028, 2, 29)).toBe(true);
    expect(isValidCalendarDate(2027, 2, 29)).toBe(false);
    expect(isValidCalendarDate(1999, 12, 31)).toBe(false);
    expect(isValidCalendarDate(2101, 1, 1)).toBe(false);
    expect(isValidCalendarDate(2026, 4, 31)).toBe(false);
  });
});

describe('text', () => {
  it('stripHtml turns block closes into newlines and decodes entities', () => {
    expect(stripHtml('<p>possono presentare domanda di&nbsp;partecipazione le&nbsp;PMI</p><ul><li>a</li></ul>')).toBe(
      'possono presentare domanda di partecipazione le PMI\na',
    );
  });

  it('stripHtml does not cut a tag at a > inside a quoted attribute (live SEDIA markup)', () => {
    expect(stripHtml('<div class="eui-u-mt-l>"><h4>Conditions</h4><div><h4>1. Admissibility</h4></div></div>')).toBe(
      'Conditions\n1. Admissibility',
    );
    expect(stripHtml('<a href=\'x>y\' title="a>b">link</a> tail')).toBe('link tail');
    // Unbalanced quote: still no markup leaks.
    expect(stripHtml('<span class="oops>text</span> after')).not.toContain('<');
  });

  it('decodeHtmlEntities handles named, decimal and hex references', () => {
    expect(decodeHtmlEntities('Chi pu&ograve; partecipare')).toBe('Chi può partecipare');
    expect(decodeHtmlEntities('&#8364; 10.000 &amp; &#x20AC;')).toBe('€ 10.000 & €');
    expect(decodeHtmlEntities('&unknownentity; stays')).toBe('&unknownentity; stays');
  });

  it('decodeHtmlEntities leaves out-of-range numeric references in place instead of throwing', () => {
    expect(() => decodeHtmlEntities('&#99999999999;')).not.toThrow();
    expect(decodeHtmlEntities('x &#99999999999; y')).toBe('x &#99999999999; y');
    expect(decodeHtmlEntities('x &#xFFFFFFFFFF; y')).toBe('x &#xFFFFFFFFFF; y');
  });

  it('excerpt cuts at a word boundary with an ellipsis', () => {
    expect(excerpt('a '.repeat(500), 20).endsWith('…')).toBe(true);
    expect(excerpt('a '.repeat(500), 20).length).toBeLessThanOrEqual(21);
    expect(excerpt('short text', 20)).toBe('short text');
  });
});
