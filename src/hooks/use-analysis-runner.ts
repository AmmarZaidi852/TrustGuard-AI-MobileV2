import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { toUserMessage } from '@/core/errors';
import type { AnalysisResult } from '@/core/types';
import type { AnalysisStage } from '@/services/analysis/pipeline';
import { createProviders } from '@/services/providers';
import type { AnalysisProviders } from '@/services/providers/types';
import { saveAnalysis } from '@/services/history/history-store';

let providers: AnalysisProviders | null = null;
const getProviders = () => (providers ??= createProviders());

type RunnerState =
  | { status: 'idle' }
  | { status: 'running'; stage: AnalysisStage | null }
  | { status: 'error'; message: string };

/** Runs an analysis, stores it in recent history and opens the result screen. */
export function useAnalysisRunner() {
  const [state, setState] = useState<RunnerState>({ status: 'idle' });
  const running = useRef(false);

  const run = useCallback(
    async (
      task: (
        providers: AnalysisProviders,
        onProgress: (stage: AnalysisStage) => void,
      ) => Promise<AnalysisResult>,
    ) => {
      if (running.current) return;
      running.current = true;
      setState({ status: 'running', stage: null });
      try {
        const result = await task(getProviders(), (stage) =>
          setState({ status: 'running', stage }),
        );
        await saveAnalysis(result);
        setState({ status: 'idle' });
        router.push({ pathname: '/result/[id]', params: { id: result.id } });
      } catch (error) {
        setState({ status: 'error', message: toUserMessage(error) });
      } finally {
        running.current = false;
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return {
    run,
    reset,
    isRunning: state.status === 'running',
    stage: state.status === 'running' ? state.stage : null,
    error: state.status === 'error' ? state.message : null,
  };
}
