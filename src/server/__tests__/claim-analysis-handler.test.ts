/**
 * @jest-environment node
 */
import type { ApiErrorBody } from '@/core/api-contract';
import { mockModelContradicted } from '@/test/fixtures';

import { ClaimAnalysisError } from '../claim-analysis/errors';
import { createClaimAnalysisHandler } from '../claim-analysis/handler';
import { createRateLimiter } from '../rate-limit';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/v1/claims/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid = { text: 'NASA discovered life on Mars.', mode: 'claim' };

function setup(analyzer = jest.fn().mockResolvedValue(mockModelContradicted)) {
  const log = jest.fn();
  const handler = createClaimAnalysisHandler({ analyzer, allowRequest: () => true, log });
  return { handler, analyzer, log };
}

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error;
}

describe('claim analysis API handler', () => {
  it('returns the analysis for a valid request', async () => {
    const { handler, analyzer } = setup();
    const response = await handler(post(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mockModelContradicted);
    expect(analyzer).toHaveBeenCalledWith(valid);
  });

  it('normalizes the text with the same validation as the app', async () => {
    const { handler, analyzer } = setup();
    await handler(post({ text: '  NASA   discovered life on Mars.  ', mode: 'claim' }));
    expect(analyzer).toHaveBeenCalledWith(valid);
  });

  it.each([
    ['empty text', { text: '   ', mode: 'text' }, /Enter some text/],
    ['too short', { text: 'hi', mode: 'claim' }, /too short/],
    ['too long', { text: 'word '.repeat(200), mode: 'claim' }, /too long/],
    ['bad mode', { text: valid.text, mode: 'poem' }, /mode/],
    ['missing text', { mode: 'text' }, /text must be a string/],
    ['invalid JSON', '{nope', /must be JSON/],
  ])('rejects %s with 400 and does not call the AI', async (_name, body, message) => {
    const { handler, analyzer } = setup();
    const response = await handler(post(body));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe('invalid_request');
    expect(error.message).toMatch(message);
    expect(analyzer).not.toHaveBeenCalled();
  });

  it('reports a missing API key as not configured (503)', async () => {
    const handler = createClaimAnalysisHandler({ analyzer: null, allowRequest: () => true });
    const response = await handler(post(valid));
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('not_configured');
  });

  it('rate limits per client', async () => {
    const analyzer = jest.fn().mockResolvedValue(mockModelContradicted);
    const handler = createClaimAnalysisHandler({
      analyzer,
      allowRequest: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    });
    const ip = { 'x-forwarded-for': '1.2.3.4' };
    expect((await handler(post(valid, ip))).status).toBe(200);
    expect((await handler(post(valid, ip))).status).toBe(200);
    const limited = await handler(post(valid, ip));
    expect(limited.status).toBe(429);
    expect((await errorOf(limited)).code).toBe('rate_limited');
    expect((await handler(post(valid, { 'x-forwarded-for': '5.6.7.8' }))).status).toBe(200);
  });

  it.each([
    ['model_refused', 422],
    ['invalid_model_output', 502],
    ['model_unavailable', 502],
    ['rate_limited', 429],
    ['not_configured', 503],
  ] as const)('maps %s analyzer errors to HTTP %i', async (code, status) => {
    const { handler, log } = setup(jest.fn().mockRejectedValue(new ClaimAnalysisError(code, 'x')));
    const response = await handler(post(valid));
    expect(response.status).toBe(status);
    expect((await errorOf(response)).code).toBe(code);
    expect(log).toHaveBeenCalled();
  });

  it('hides unexpected internal errors behind a generic 500', async () => {
    const { handler } = setup(jest.fn().mockRejectedValue(new Error('secret stack detail')));
    const response = await handler(post(valid));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).message).not.toMatch(/secret/);
  });
});

describe('createRateLimiter', () => {
  it('resets after the window', () => {
    let now = 0;
    const allow = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    now = 1000;
    expect(allow('a')).toBe(true);
  });
});
