import { describe, it, expect, afterEach } from 'vitest';
import { activePublisherId, getActivePublisher } from './publishers';
import { stubPublisher } from './publishers/stub';
import { netlifyPublisher } from './publishers/netlify';
import { activeSenderId, getActiveSender } from './senders';
import { stubSender } from './senders/stub';
import { resendSender } from './senders/resend';
import { markFormsForNetlify } from './publish';

const ENV_KEYS = ['LAUNCH_PUBLISHER', 'NETLIFY_API_KEY', 'LAUNCH_SENDER', 'RESEND_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('publisher registry', () => {
  it('defaults to stub with no env', () => {
    delete process.env.LAUNCH_PUBLISHER;
    expect(activePublisherId()).toBe('stub');
    expect(getActivePublisher().id).toBe('stub');
  });

  it('unknown driver id falls back to stub', () => {
    process.env.LAUNCH_PUBLISHER = 'daytona';
    expect(activePublisherId()).toBe('stub');
  });

  it('netlify selected but unconfigured → LOUD fallback to stub', () => {
    process.env.LAUNCH_PUBLISHER = 'netlify';
    delete process.env.NETLIFY_API_KEY;
    expect(netlifyPublisher.isConfigured()).toBe(false);
    expect(getActivePublisher().id).toBe('stub');
  });

  it('netlify selected and configured → netlify', () => {
    process.env.LAUNCH_PUBLISHER = 'netlify';
    process.env.NETLIFY_API_KEY = 'nfp_test';
    expect(getActivePublisher().id).toBe('netlify');
  });

  it('stub publish returns a live data: URL embedding the html', async () => {
    const res = await stubPublisher.publish({ projectId: 'p1', slug: 'test', html: '<html>SENTINEL</html>' });
    expect(res.status).toBe('live');
    expect(res.url.startsWith('data:text/html;base64,')).toBe(true);
    const decoded = Buffer.from(res.url.split(',')[1], 'base64').toString();
    expect(decoded).toContain('SENTINEL');
  });

  it('stub republish keeps the existing hostRef', async () => {
    const res = await stubPublisher.publish({ projectId: 'p1', slug: 't', html: '<p>x</p>', existingHostRef: 'stub' });
    expect(res.hostRef).toBe('stub');
  });
});

describe('sender registry', () => {
  it('defaults to stub and stub send never sends', async () => {
    delete process.env.LAUNCH_SENDER;
    expect(activeSenderId()).toBe('stub');
    const out = await stubSender.send({ projectId: 'p1', to: ['a@b.c'], subject: 's', html: '<p>x</p>' });
    expect(out).toMatchObject({ ok: true, stubbed: true, providerRef: 'stub' });
  });

  it('resend selected but keyless → fallback to stub', () => {
    process.env.LAUNCH_SENDER = 'resend';
    delete process.env.RESEND_API_KEY;
    expect(resendSender.isConfigured()).toBe(false);
    expect(getActiveSender().id).toBe('stub');
  });
});

describe('markFormsForNetlify', () => {
  it('adds data-netlify + name to a plain form', () => {
    const out = markFormsForNetlify('<form class="cta"><input type="email"></form>');
    expect(out).toContain('data-netlify="true"');
    expect(out).toContain('name="signup"');
  });

  it('keeps an existing form name', () => {
    const out = markFormsForNetlify('<form name="waitlist"><input></form>');
    expect(out).toContain('data-netlify="true"');
    expect(out).toContain('name="waitlist"');
    expect(out).not.toContain('name="signup"');
  });

  it('leaves forms with an explicit action alone (external handler)', () => {
    const html = '<form action="https://example.com/subscribe"><input></form>';
    expect(markFormsForNetlify(html)).toBe(html);
  });

  it('does not double-mark an already-netlify form', () => {
    const html = '<form data-netlify="true" name="signup"><input></form>';
    expect(markFormsForNetlify(html)).toBe(html);
  });
});
