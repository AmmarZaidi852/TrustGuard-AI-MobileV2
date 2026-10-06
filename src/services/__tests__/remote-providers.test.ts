import { ServiceRequestError, ServiceUnavailableError, ValidationError } from '@/core/errors';

import { postJson } from '../http/api-client';
import { createRemoteProviders, parseClaimAnalysis, parseImageAnalysis } from '../providers/remote';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const validAnalysis = {
  extractedClaim: 'NASA discovered life on Mars.',
  claimType: 'scientific_health',
  verifiable: true,
  verifiabilityNote: '',
  stance: 'contradicted',
  confidence: 0.8,
  reasoning: 'No such discovery is part of established knowledge.',
  indicators: [{ label: 'Extraordinary claim', direction: 'raises_concern', weight: 0.5 }],
  evidenceNeeded: ['An official NASA announcement'],
  limitations: '',
  model: 'claude-opus-5-5',
};

const request = { text: 'NASA discovered life on Mars.', mode: 'claim' as const };

describe('postJson', () => {
  const call = (fetchImpl: typeof fetch, timeoutMs = 1000) =>
    postJson('https://api.test/x', {}, { timeoutMs, fetchImpl });

  it('maps network failures', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(call(fetchImpl)).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps HTTP errors and keeps the backend error code and message', async () => {
    const fetchImpl = jest.fn(() =>
      jsonResponse({ error: { code: 'rate_limited', message: 'Slow down' } }, 429),
    );
    await expect(call(fetchImpl)).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      code: 'rate_limited',
      message: 'Slow down',
    });
  });

  it('handles HTTP errors without a JSON body', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response('Bad gateway', { status: 502 })));
    await expect(call(fetchImpl)).rejects.toMatchObject({ kind: 'http', status: 502 });
  });

  it('maps timeouts', async () => {
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(call(fetchImpl, 10)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('maps non-JSON success bodies', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(call(fetchImpl)).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

describe('remote claim analyzer', () => {
  it('posts the content to the backend and parses a valid analysis', async () => {
    const fetchImpl = jest.fn(() => jsonResponse(validAnalysis));
    const providers = createRemoteProviders('https://api.test', 1000, fetchImpl as typeof fetch);
    const result = await providers.claimAnalyzer.analyzeClaim(request);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/v1/claims/analyze',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    );
    expect(result.stance).toBe('contradicted');
    expect(result.indicators[0]).toMatchObject({ id: 'model_0', origin: 'model' });
  });

  it('uses relative URLs when no base URL is configured', async () => {
    const fetchImpl = jest.fn(() => jsonResponse(validAnalysis));
    await createRemoteProviders('', 1000, fetchImpl as typeof fetch).claimAnalyzer.analyzeClaim(
      request,
    );
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/claims/analyze', expect.anything());
  });

  it('reports a server without credentials as "not connected"', async () => {
    const fetchImpl = jest.fn(() =>
      jsonResponse({ error: { code: 'not_configured', message: 'missing key' } }, 503),
    );
    const providers = createRemoteProviders('', 1000, fetchImpl as typeof fetch);
    await expect(providers.claimAnalyzer.analyzeClaim(request)).rejects.toThrow(
      ServiceUnavailableError,
    );
  });

  it('surfaces server-side validation errors as validation errors', async () => {
    const fetchImpl = jest.fn(() =>
      jsonResponse({ error: { code: 'invalid_request', message: 'The claim is too short.' } }, 400),
    );
    const providers = createRemoteProviders('', 1000, fetchImpl as typeof fetch);
    await expect(providers.claimAnalyzer.analyzeClaim(request)).rejects.toThrow(
      new ValidationError('The claim is too short.'),
    );
  });

  it.each([
    ['unknown stance', { stance: 'definitely_true' }],
    ['confidence out of range', { confidence: 1.5 }],
    ['missing claim', { extractedClaim: undefined }],
    ['non-boolean verifiable', { verifiable: 'yes' }],
    ['unknown claim type', { claimType: 'gossip' }],
  ])('rejects malformed analysis: %s', (_name, patch) => {
    expect(() => parseClaimAnalysis({ ...validAnalysis, ...patch })).toThrow(ServiceRequestError);
  });

  it('applies the shared guard rails to backend responses', () => {
    const result = parseClaimAnalysis({ ...validAnalysis, verifiable: false, confidence: 1 });
    expect(result.stance).toBe('unverifiable');
    expect(result.confidence).toBeLessThanOrEqual(0.9);
  });
});

describe('other remote providers', () => {
  it('rejects malformed image analyses', () => {
    expect(() => parseImageAnalysis({ aiGeneration: { likelihood: 'high' }, model: 'x' })).toThrow(
      ServiceRequestError,
    );
  });

  it('refuses to send an image without data', async () => {
    const providers = createRemoteProviders('https://api.test', 1000, jest.fn() as typeof fetch);
    await expect(providers.visionAnalyzer.analyzeImage({ uri: 'file://a.jpg' })).rejects.toThrow(
      /could not be read/,
    );
  });
});
