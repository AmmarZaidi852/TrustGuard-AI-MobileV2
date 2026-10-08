/**
 * @jest-environment node
 */
import type { ApiErrorBody } from '@/core/api-contract';
import { guardImageAnalysis } from '@/core/image/image-guards';
import { IMAGE_BYTES, mockImageReading } from '@/test/fixtures';

import { ApiError } from '../api-error';
import { MAX_IMAGE_REQUEST_BYTES, createImageHandler } from '../image/handler';
import { createRateLimiter } from '../rate-limit';

const reading = guardImageAnalysis(mockImageReading);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/v1/images/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function setup(analyzer = jest.fn().mockResolvedValue(reading)) {
  const log = jest.fn();
  const handler = createImageHandler({ analyzer, allowRequest: () => true, log });
  return { handler, analyzer, log };
}

const errorOf = async (response: Response) => ((await response.json()) as ApiErrorBody).error;

describe('image analysis API handler', () => {
  it('validates the image and returns the structured reading (no image data echoed)', async () => {
    const { handler, analyzer } = setup();
    const response = await handler(post({ image: IMAGE_BYTES.png, mediaType: 'image/png' }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual(reading);
    expect(body).not.toContain(IMAGE_BYTES.png.slice(0, 40));
    expect(analyzer).toHaveBeenCalledWith({ image: IMAGE_BYTES.png, mediaType: 'image/png' });
  });

  it.each([
    [
      'unsupported format (PDF)',
      { image: IMAGE_BYTES.pdf, mediaType: 'image/png' },
      415,
      'unsupported_image',
    ],
    [
      'unsupported format (HEIC)',
      { image: IMAGE_BYTES.heic, mediaType: 'image/jpeg' },
      415,
      'unsupported_image',
    ],
    [
      'malformed base64',
      { image: '%%%not-base64%%%', mediaType: 'image/png' },
      400,
      'invalid_image',
    ],
    ['empty image', { image: '', mediaType: 'image/png' }, 400, 'empty_image'],
    ['missing image', { mediaType: 'image/png' }, 400, 'empty_image'],
    [
      'declared type that does not match the bytes',
      { image: IMAGE_BYTES.png, mediaType: 'image/jpeg' },
      400,
      'invalid_image',
    ],
    ['missing declared type', { image: IMAGE_BYTES.png }, 400, 'invalid_image'],
    ['non-JSON body', 'not json', 400, 'invalid_request'],
  ] as const)('rejects %s even when the app is bypassed', async (_name, body, status, code) => {
    const { handler, analyzer } = setup();
    const response = await handler(post(body));
    expect(response.status).toBe(status);
    expect((await errorOf(response)).code).toBe(code);
    expect(analyzer).not.toHaveBeenCalled();
  });

  it('rejects oversized uploads from the declared length without reading them', async () => {
    const { handler, analyzer } = setup();
    const request = post(
      { image: IMAGE_BYTES.png, mediaType: 'image/png' },
      {
        'content-length': String(MAX_IMAGE_REQUEST_BYTES + 1),
      },
    );
    const response = await handler(request);
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('image_too_large');
    expect(analyzer).not.toHaveBeenCalled();
  });

  it('rejects oversized uploads that lie about their length', async () => {
    const { handler } = setup();
    const huge = IMAGE_BYTES.jpeg.slice(0, 8) + 'A'.repeat(MAX_IMAGE_REQUEST_BYTES);
    const response = await handler(post({ image: huge, mediaType: 'image/jpeg' }));
    expect(response.status).toBe(413);
  });

  it('reports a missing API key as not configured, after validating the image', async () => {
    const handler = createImageHandler({ analyzer: null, allowRequest: () => true });
    const response = await handler(post({ image: IMAGE_BYTES.png, mediaType: 'image/png' }));
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('not_configured');
  });

  it.each([
    ['vision model failure', 'model_unavailable', 502],
    ['malformed vision output', 'invalid_model_output', 502],
    ['timeout', 'timeout', 504],
    ['refusal', 'model_refused', 422],
    ['API key failure', 'not_configured', 503],
  ] as const)('maps %s', async (_name, code, status) => {
    const { handler } = setup(jest.fn().mockRejectedValue(new ApiError(code, 'x')));
    const response = await handler(post({ image: IMAGE_BYTES.png, mediaType: 'image/png' }));
    expect(response.status).toBe(status);
    expect((await errorOf(response)).code).toBe(code);
  });

  it('never logs image bytes, even on unexpected errors', async () => {
    const secret = IMAGE_BYTES.jpeg;
    const { handler, log } = setup(jest.fn().mockRejectedValue(new Error(`boom ${secret}`)));
    const response = await handler(post({ image: secret, mediaType: 'image/jpeg' }));
    expect(response.status).toBe(500);
    const logged = log.mock.calls.flat().join('\n');
    expect(logged).not.toContain(secret.slice(0, 24));
    expect(logged).not.toContain('boom');
    expect(await response.text()).not.toContain(secret.slice(0, 24));
  });

  it('rate limits image analyses per client', async () => {
    const handler = createImageHandler({
      analyzer: jest.fn().mockResolvedValue(reading),
      allowRequest: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    const ip = { 'x-forwarded-for': '7.7.7.7' };
    const body = { image: IMAGE_BYTES.png, mediaType: 'image/png' };
    expect((await handler(post(body, ip))).status).toBe(200);
    expect((await handler(post(body, ip))).status).toBe(429);
  });
});
