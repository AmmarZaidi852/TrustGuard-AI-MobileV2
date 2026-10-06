import { config } from '../config';
import { createRemoteProviders } from './remote';
import type { AnalysisProviders } from './types';
import { createUnavailableProviders } from './unavailable';

export function createProviders(): AnalysisProviders {
  return config.apiBaseUrl
    ? createRemoteProviders(config.apiBaseUrl, config.requestTimeoutMs)
    : createUnavailableProviders();
}

export type * from './types';
