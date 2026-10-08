import { config } from '../config';
import { createRemoteProviders } from './remote';
import type { AnalysisProviders } from './types';
import { createUnavailableProviders } from './unavailable';

/**
 * Which backend services exist yet. Services not built yet report "not connected"
 * explicitly instead of calling endpoints that do not exist.
 */
export const capabilities = {
  claimAnalysis: true,
  evidenceSearch: true,
  imageAnalysis: true,
} as const;

export function createProviders(): AnalysisProviders {
  const remote = createRemoteProviders(
    config.apiBaseUrl,
    config.requestTimeoutMs,
    undefined,
    config.evidenceTimeoutMs,
    config.imageTimeoutMs,
  );
  const unavailable = createUnavailableProviders();
  return {
    claimAnalyzer: capabilities.claimAnalysis ? remote.claimAnalyzer : unavailable.claimAnalyzer,
    evidenceRetriever: capabilities.evidenceSearch
      ? remote.evidenceRetriever
      : unavailable.evidenceRetriever,
    visionAnalyzer: capabilities.imageAnalysis ? remote.visionAnalyzer : unavailable.visionAnalyzer,
  };
}

export type * from './types';
