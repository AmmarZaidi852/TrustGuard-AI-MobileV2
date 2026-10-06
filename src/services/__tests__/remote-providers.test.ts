import { ServiceRequestError } from '@/core/errors';
import { extractSingleClaim } from '@/core/claims/claim-extraction';

import { postJson } from '../http/api-client';
import { createRemoteProviders, parseClaimAnalysis, parseImageAnalysis } from '../providers/remote';

const claim = extractSingleClaim('NASA discovered life on Mars.')!;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('postJson', () => {
  it('maps network failures', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(
      postJson('https://api.test/x', {}, { timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('maps HTTP errors with status', async () => {
    const fetchImpl = jest.fn(() => jsonResponse({ error: 'boom' }, 502));
    await expect(
      postJson('https://api.test/x', {}, { timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'http',
      status: 502,
    });
  });

  it('maps timeouts', async () => {
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      postJson('https://api.test/x', {}, { timeoutMs: 10, fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('maps non-JSON bodies', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(
      postJson('https://api.test/x', {}, { timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('remote providers', () => {
  it('posts to the backend and parses a valid claim analysis', async () => {
    const fetchImpl = jest.fn(() =>
      jsonResponse({
        stance: 'unverifiable',
        confidence: 0.4,
        reasoning: 'No credible reports.',
        indicators: [{ label: 'Extraordinary claim', direction: 'raises_concern', weight: 0.5 }],
        evidenceNeeded: ['Peer-reviewed publication'],
        model: 'test-model',
      }),
    );
    const providers = createRemoteProviders('https://api.test', 1000, fetchImpl as typeof fetch);
    const result = await providers.claimAnalyzer.analyzeClaim(claim, 'context');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/v1/claims/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.stance).toBe('unverifiable');
    expect(result.indicators[0]).toMatchObject({ id: 'model_0', origin: 'model' });
  });

  it('rejects malformed responses instead of trusting them', () => {
    expect(() => parseClaimAnalysis({ stance: 'definitely_true', confidence: 2 })).toThrow(
      ServiceRequestError,
    );
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
