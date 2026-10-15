import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ServiceRequestError, ValidationError } from '@/core/errors';
import type { AnalysisResult } from '@/core/types';
import { analyzeText, type AnalysisStage } from '@/services/analysis/pipeline';
import { getAnalysis, resetHistoryCache } from '@/services/history/history-store';
import { postJson } from '@/services/http/api-client';
import type { AnalysisProviders } from '@/services/providers/types';
import { mockContradictingEvidence, mockModelContradicted, mockProviders } from '@/test/fixtures';

import { useAnalysisRunner } from '../use-analysis-runner';

type Task = (
  providers: AnalysisProviders,
  onProgress: (stage: AnalysisStage) => void,
) => Promise<AnalysisResult>;

const CLAIM = 'Drinking coffee completely prevents cancer.';

/** A promise the test settles by hand, so no step depends on timing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A real result from the real pipeline, with mocked providers (no network). */
const realResult = () =>
  analyzeText(
    CLAIM,
    'claim',
    mockProviders({ model: mockModelContradicted, evidence: mockContradictingEvidence }),
  );

let push: jest.SpyInstance;

beforeEach(() => {
  resetHistoryCache();
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
});

afterEach(() => {
  push.mockRestore();
});

async function setup() {
  const hook = await renderHook(() => useAnalysisRunner());
  /** Starts a run and flushes its first state update, without waiting for it to finish. */
  const start = async (task: Task) => {
    let pending!: Promise<void>;
    await act(async () => {
      pending = hook.result.current.run(task);
    });
    // Wrapped: an async function returning a promise would wait for the run itself.
    return { pending };
  };
  return { ...hook, start };
}

describe('useAnalysisRunner', () => {
  it('starts idle', async () => {
    const { result } = await setup();
    expect(result.current).toMatchObject({ isRunning: false, stage: null, error: null });
  });

  it('reports each progress stage, then stores the result and opens it', async () => {
    const { result, start } = await setup();
    const analysis = await realResult();
    const gate = deferred<AnalysisResult>();
    let report!: (stage: AnalysisStage) => void;

    const { pending } = await start((_providers, onProgress) => {
      report = onProgress;
      return gate.promise;
    });
    expect(result.current).toMatchObject({ isRunning: true, stage: null, error: null });

    await act(async () => report('analyzing_claim'));
    expect(result.current.stage).toBe('analyzing_claim');
    await act(async () => report('checking_sources'));
    expect(result.current.stage).toBe('checking_sources');
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve(analysis);
      await pending;
    });

    expect(result.current).toMatchObject({ isRunning: false, stage: null, error: null });
    expect(await getAnalysis(analysis.id)).toEqual(analysis);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: analysis.id } });
  });

  it.each([
    [
      'an API error',
      new ServiceRequestError('x', 'http', 503, 'model_unavailable'),
      /temporarily unavailable/,
    ],
    [
      'a malformed response',
      new ServiceRequestError('Response was not valid JSON', 'invalid_response'),
      /unexpected response/,
    ],
    ['a timeout', new ServiceRequestError('Request timed out', 'timeout'), /took too long/],
    ['a network failure', new ServiceRequestError('offline', 'network'), /Could not reach/],
    ['invalid input', new ValidationError('The claim is too short.'), /^The claim is too short\.$/],
    ['an unexpected error', new Error('boom'), /^Something went wrong/],
  ])('shows %s as an error, stores nothing and stays put', async (_name, failure, message) => {
    const { result } = await setup();

    await act(() => result.current.run(() => Promise.reject(failure)));

    expect(result.current.isRunning).toBe(false);
    expect(result.current.stage).toBeNull();
    expect(result.current.error).toMatch(message);
    expect(push).not.toHaveBeenCalled();
  });

  it('turns a real request timeout into the timeout message', async () => {
    const { result } = await setup();
    // A server that never answers: only postJson's own timeout can end the request.
    const neverAnswers = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      )) as typeof fetch;

    await act(() =>
      result.current.run(() =>
        postJson<AnalysisResult>(
          'http://127.0.0.1:9/api/v1/claims/analyze',
          {},
          { timeoutMs: 10, fetchImpl: neverAnswers },
        ),
      ),
    );

    expect(result.current.error).toMatch(/took too long/);
    expect(result.current.isRunning).toBe(false);
  });

  it('ignores a second run while one is in progress (no duplicate requests)', async () => {
    const { result, start } = await setup();
    const analysis = await realResult();
    const gate = deferred<AnalysisResult>();
    const first = jest.fn<Promise<AnalysisResult>, Parameters<Task>>(() => gate.promise);
    const second = jest.fn<Promise<AnalysisResult>, Parameters<Task>>(() => gate.promise);

    const { pending } = await start(first);
    await act(() => result.current.run(second));
    await act(() => result.current.run(second));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      gate.resolve(analysis);
      await pending;
    });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a failure, and a success clears the error', async () => {
    const { result } = await setup();
    const analysis = await realResult();

    await act(() =>
      result.current.run(() => Promise.reject(new ServiceRequestError('x', 'timeout'))),
    );
    expect(result.current.error).toMatch(/took too long/);

    const retry = jest.fn<Promise<AnalysisResult>, Parameters<Task>>(() =>
      Promise.resolve(analysis),
    );
    await act(() => result.current.run(retry));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ isRunning: false, error: null });
    expect(push).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: analysis.id } });
  });

  it('clears a previous error as soon as a new run starts', async () => {
    const { result, start } = await setup();
    await act(() => result.current.run(() => Promise.reject(new Error('boom'))));
    expect(result.current.error).not.toBeNull();

    const gate = deferred<AnalysisResult>();
    const { pending } = await start(() => gate.promise);
    expect(result.current).toMatchObject({ isRunning: true, error: null });

    await act(async () => {
      gate.reject(new Error('boom'));
      await pending;
    });
  });

  it('reset() dismisses the error', async () => {
    const { result } = await setup();
    await act(() => result.current.run(() => Promise.reject(new Error('boom'))));
    expect(result.current.error).not.toBeNull();

    await act(async () => result.current.reset());
    expect(result.current).toMatchObject({ isRunning: false, stage: null, error: null });
  });

  it('a task that fails after reporting progress leaves no stale stage behind', async () => {
    const { result } = await setup();
    await act(() =>
      result.current.run(async (_providers, onProgress) => {
        onProgress('checking_sources');
        throw new ServiceRequestError('x', 'http', 503, 'search_unavailable');
      }),
    );
    expect(result.current).toMatchObject({ isRunning: false, stage: null });
    expect(result.current.error).toMatch(/Web search is unavailable/);
  });

  it('unmounting during a run does not throw, and the finished result is still saved', async () => {
    const { start, unmount } = await setup();
    const analysis = await realResult();
    const gate = deferred<AnalysisResult>();

    const { pending } = await start(() => gate.promise);
    await unmount();
    gate.resolve(analysis);
    await expect(pending).resolves.toBeUndefined();

    expect(await getAnalysis(analysis.id)).toEqual(analysis);
  });

  it('passes the real app providers, created once and reused across runs', async () => {
    const { result } = await setup();
    const seen: AnalysisProviders[] = [];
    const capture: Task = (providers) => {
      seen.push(providers);
      return Promise.reject(new Error('stop'));
    };

    await act(() => result.current.run(capture));
    await act(() => result.current.run(capture));

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(Object.keys(seen[0]).sort()).toEqual([
      'claimAnalyzer',
      'evidenceRetriever',
      'visionAnalyzer',
    ]);
  });

  it('with the real providers, a request is stopped by the test network guard', async () => {
    const { result } = await setup();

    // Calls through to the guard installed by jest.setup.ts.
    const guarded = jest.spyOn(globalThis, 'fetch');
    try {
      await act(() => result.current.run((providers) => analyzeText(CLAIM, 'claim', providers)));

      // The request went to the app's API route and was refused locally by the guard.
      expect(guarded).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/claims/analyze'),
        expect.anything(),
      );
      await expect(guarded.mock.results[0].value).rejects.toThrow(
        /Network access is blocked in tests/,
      );
      expect(result.current.error).toMatch(/Could not reach the analysis service/);
      expect(push).not.toHaveBeenCalled();
    } finally {
      guarded.mockRestore();
    }
  });
});
