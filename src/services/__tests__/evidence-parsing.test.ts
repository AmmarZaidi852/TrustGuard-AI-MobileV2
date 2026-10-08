import { ServiceRequestError, ServiceUnavailableError } from '@/core/errors';
import { extractSingleClaim } from '@/core/claims/claim-extraction';
import { MODEL_LIMITS } from '@/core/model/model-analysis';

import { createRemoteProviders, parseEvidence } from '../providers/remote';

/* MOCK BACKEND RESPONSES — test fixtures only. */
const source = (patch: Record<string, unknown> = {}) => ({
  id: 'S1',
  title: 'Coffee and Cancer Risk',
  url: 'https://www.cancer.gov/coffee',
  domain: 'cancer.gov',
  excerpt: 'There is no evidence that coffee prevents cancer.',
  relationship: 'contradicts',
  relevance: 'high',
  explanation: 'Directly addresses the claim.',
  ...patch,
});

const evaluation = (patch: Record<string, unknown> = {}) => ({
  verdict: 'contradicted',
  confidence: 0.8,
  whatSourcesSay: 'The NCI says there is no evidence.',
  inference: 'The claim is not supported.',
  uncertainty: 'Some associations exist.',
  missingEvidence: [],
  searchQueries: ['coffee cancer'],
  model: 'claude-opus-5-5',
  ...patch,
});

describe('parseEvidence', () => {
  it('parses sources and the source-backed evaluation', () => {
    const result = parseEvidence({
      sources: [source()],
      evaluation: evaluation(),
      rejectedSources: 0,
    });
    expect(result.sources).toEqual([
      {
        title: 'Coffee and Cancer Risk',
        url: 'https://www.cancer.gov/coffee',
        publisher: 'cancer.gov',
        snippet: 'There is no evidence that coffee prevents cancer.',
        stance: 'contradicts',
        relevance: 'high',
        explanation: 'Directly addresses the claim.',
        publishedAt: undefined,
      },
    ]);
    expect(result.evaluation?.verdict).toBe('contradicted');
  });

  it('accepts zero sources with no evaluation', () => {
    expect(parseEvidence({ sources: [], evaluation: null, rejectedSources: 2 })).toEqual({
      sources: [],
      evaluation: null,
      rejectedSources: 2,
    });
  });

  it('drops individual sources with invalid or unsafe URLs and counts them', () => {
    const result = parseEvidence({
      sources: [
        source({ id: 'S1', url: 'javascript:alert(1)' }),
        source({ id: 'S2', url: 'http://localhost:8081/x' }),
        source({ id: 'S3', url: 'https://www.who.int/ok' }),
      ],
      evaluation: evaluation(),
      rejectedSources: 0,
    });
    expect(result.sources.map((s) => s.url)).toEqual(['https://www.who.int/ok']);
    expect(result.rejectedSources).toBe(2);
  });

  it('drops sources with malformed fields', () => {
    const result = parseEvidence({
      sources: [
        source({ relationship: 'proves' }),
        source({ title: '' }),
        source({ relevance: 9 }),
      ],
      evaluation: evaluation(),
    });
    expect(result.sources).toEqual([]);
    expect(result.evaluation).toBeNull();
  });

  it.each([
    ['non-object body', 'oops'],
    ['sources not a list', { sources: 'many', evaluation: null }],
    ['unknown verdict', { sources: [source()], evaluation: evaluation({ verdict: 'true' }) }],
    ['confidence out of range', { sources: [source()], evaluation: evaluation({ confidence: 3 }) }],
  ])('rejects a structurally malformed response: %s', (_name, body) => {
    expect(() => parseEvidence(body)).toThrow(ServiceRequestError);
  });

  it('re-applies the guard rails in the app (no supporting source → no "supported")', () => {
    const result = parseEvidence({
      sources: [source({ relationship: 'context' })],
      evaluation: evaluation({ verdict: 'supported', confidence: 0.9 }),
    });
    expect(result.evaluation?.verdict).toBe('insufficient_evidence');
    expect(result.evaluation!.confidence).toBeLessThanOrEqual(MODEL_LIMITS.maxConfidence);
  });
});

describe('remote evidence retriever', () => {
  const claim = extractSingleClaim('Coffee prevents cancer in adults.')!;

  it('sends the normalized claim and its type to the backend', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(Response.json({ sources: [], evaluation: null, rejectedSources: 0 })),
    );
    await createRemoteProviders('', 1000, fetchImpl as typeof fetch).evidenceRetriever.findEvidence(
      claim,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/evidence/search',
      expect.objectContaining({
        body: JSON.stringify({ claim: claim.text, claimType: claim.type }),
      }),
    );
  });

  it('reports an unconfigured server as not connected', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        Response.json({ error: { code: 'not_configured', message: 'x' } }, { status: 503 }),
      ),
    );
    await expect(
      createRemoteProviders('', 1000, fetchImpl as typeof fetch).evidenceRetriever.findEvidence(
        claim,
      ),
    ).rejects.toThrow(ServiceUnavailableError);
  });
});

describe('evidence request timeout', () => {
  it('gives source checks a longer timeout than claim analysis', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const providers = createRemoteProviders('', 1_000, fetchImpl as typeof fetch, 5_000);
    const claim = extractSingleClaim('Coffee prevents cancer in adults.')!;
    const pending = providers.evidenceRetriever.findEvidence(claim);
    const settled = jest.fn();
    pending.catch(settled);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(4_000);
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    jest.useRealTimers();
  });
});
