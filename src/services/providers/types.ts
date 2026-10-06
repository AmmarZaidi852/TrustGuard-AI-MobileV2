import type {
  EvidenceStance,
  ExtractedClaim,
  ImageAuthenticityAnalysis,
  ModelClaimAnalysis,
  OcrResult,
} from '@/core/types';
import type { ImageInput } from '@/core/validation';

/**
 * Contracts for external analysis services. Each one is implemented by a backend
 * call (see `remote.ts`) or by `unavailable.ts` when no backend is configured.
 * Swapping models or vendors only requires a new implementation of these.
 */

export interface ClaimAnalyzer {
  analyzeClaim(claim: ExtractedClaim, context: string): Promise<ModelClaimAnalysis>;
}

/** Evidence as returned by retrieval, before on-device source evaluation. */
export interface RetrievedEvidence {
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  stance: EvidenceStance;
  publishedAt?: string;
}

export interface EvidenceRetriever {
  findEvidence(claim: ExtractedClaim): Promise<RetrievedEvidence[]>;
}

export interface VisionAnalyzer {
  analyzeImage(image: ImageInput): Promise<ImageAuthenticityAnalysis>;
}

export interface OcrProvider {
  extractText(image: ImageInput): Promise<OcrResult>;
}

export interface AnalysisProviders {
  claimAnalyzer: ClaimAnalyzer;
  evidenceRetriever: EvidenceRetriever;
  visionAnalyzer: VisionAnalyzer;
  ocr: OcrProvider;
}
