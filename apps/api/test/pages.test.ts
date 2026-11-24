import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers';
import { createApp } from '../src/index';
import { ConsoleProvider } from '../src/otp/providers';

describe('public pages', () => {
  it('home, privacy, terms and delete-account are public HTML pages', async () => {
    const c = makeClient();
    const app = createApp({ now: () => c.clock.now, provider: () => new ConsoleProvider() });
    for (const [path, words] of [['/', 'كاشيرو'], ['/privacy', 'Backups'], ['/terms', 'شروط'], ['/delete-account', 'حذف']] as const) {
      const r = await app.request(path, {}, c.env);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
      const html = await r.text();
      expect(html).toContain(words);
      expect(html).not.toMatch(/<script/i);
    }
    const p = await (await app.request('/privacy', {}, c.env)).text();
    expect(p).toContain('Server backups');
    expect(p).not.toContain('Drive');
  });
});
