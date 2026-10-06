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
  evidenceSearch: false,
  imageAnalysis: false,
} as const;

export function createProviders(): AnalysisProviders {
  const remote = createRemoteProviders(config.apiBaseUrl, config.requestTimeoutMs);
  const unavailable = createUnavailableProviders();
  return {
    claimAnalyzer: capabilities.claimAnalysis ? remote.claimAnalyzer : unavailable.claimAnalyzer,
    evidenceRetriever: capabilities.evidenceSearch
      ? remote.evidenceRetriever
      : unavailable.evidenceRetriever,
    visionAnalyzer: capabilities.imageAnalysis ? remote.visionAnalyzer : unavailable.visionAnalyzer,
    ocr: capabilities.imageAnalysis ? remote.ocr : unavailable.ocr,
  };
}

export type * from './types';
