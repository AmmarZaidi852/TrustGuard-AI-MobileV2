import { ServiceUnavailableError } from '@/core/errors';

import type { AnalysisProviders } from './types';

/**
 * Used when no analysis backend is configured. Every call fails explicitly so the
 * pipeline reports the component as "not connected" instead of inventing output.
 */
export function createUnavailableProviders(): AnalysisProviders {
  return {
    claimAnalyzer: {
      analyzeClaim: () => Promise.reject(new ServiceUnavailableError('AI claim analysis')),
    },
    evidenceRetriever: {
      findEvidence: () => Promise.reject(new ServiceUnavailableError('Source checking')),
    },
    visionAnalyzer: {
      analyzeImage: () => Promise.reject(new ServiceUnavailableError('Image analysis')),
    },
  };
}
