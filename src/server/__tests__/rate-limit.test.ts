/**
 * @jest-environment node
 */
import { clientKey, createRateLimiter } from '../rate-limit';

const request = (headers: Record<string, string>) =>
  new Request('http://localhost/x', { method: 'POST', headers });

describe('clientKey', () => {
  it("prefers the platform's CF-Connecting-IP over a caller-supplied X-Forwarded-For", () => {
    expect(
      clientKey(request({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' })),
    ).toBe('1.1.1.1');
  });

  it('cannot be changed by rotating X-Forwarded-For behind Cloudflare', () => {
    const allow = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const results = ['2.2.2.2', '3.3.3.3', '4.4.4.4'].map((spoofed) =>
      allow(clientKey(request({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': spoofed }))),
    );
    expect(results).toEqual([true, true, false]);
  });

  it('falls back to the first X-Forwarded-For entry, then to a shared key', () => {
    expect(clientKey(request({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }))).toBe('5.5.5.5');
    expect(clientKey(request({}))).toBe('unknown');
  });
});
