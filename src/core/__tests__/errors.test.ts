import type { ApiErrorCode } from '../api-contract';
import { ServiceRequestError, toUserMessage } from '../errors';
import { postJson } from '@/services/http/api-client';

const GENERIC = /returned an error|Something went wrong/;

const ALL_CODES: Record<ApiErrorCode, true> = {
  invalid_request: true,
  not_configured: true,
  rate_limited: true,
  provider_billing: true,
  model_refused: true,
  content_blocked: true,
  model_unavailable: true,
  invalid_model_output: true,
  timeout: true,
  search_unavailable: true,
  evaluation_failed: true,
  empty_image: true,
  unsupported_image: true,
  image_too_large: true,
  invalid_image: true,
  internal: true,
};

describe('toUserMessage', () => {
  // `not_configured` is turned into a ServiceUnavailableError by the remote providers
  // before it reaches here, so it is the one code allowed to fall back.
  it.each(Object.keys(ALL_CODES).filter((code) => code !== 'not_configured'))(
    'gives a specific message for the API code %s',
    (code) => {
      const error = new ServiceRequestError('Server text.', 'http', 500, code as ApiErrorCode);
      expect(toUserMessage(error)).not.toMatch(GENERIC);
    },
  );

  it.each([
    [408, /took too long/],
    [504, /took too long/],
    [524, /took too long/],
    [413, /too large/],
    [429, /Too many analyses/],
    [502, /temporarily unavailable/],
    [503, /temporarily unavailable/],
  ])('explains a %i from the hosting platform (no API error code)', (status, message) => {
    expect(toUserMessage(new ServiceRequestError(`HTTP ${status}`, 'http', status))).toMatch(
      message,
    );
  });

  it('keeps the generic message, with the status, for anything else', () => {
    expect(toUserMessage(new ServiceRequestError('HTTP 418', 'http', 418))).toBe(
      'The analysis service returned an error (418).',
    );
  });

  it('a gateway timeout page from the host reads as a timeout in the app', async () => {
    // What Cloudflare returns when the origin is too slow: HTML, not the API's JSON.
    const fetchImpl = (async () =>
      new Response('<html><body>Error 524: A timeout occurred</body></html>', {
        status: 524,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const error = await postJson('https://api.example/x', {}, { timeoutMs: 1_000, fetchImpl }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ServiceRequestError);
    expect(toUserMessage(error)).toMatch(/took too long/);
    // The host's HTML never reaches the user.
    expect(toUserMessage(error)).not.toMatch(/html|524/i);
  });
});
