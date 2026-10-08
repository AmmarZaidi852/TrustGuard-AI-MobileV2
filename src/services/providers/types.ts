import type { ClaimAnalysisRequest } from '@/core/api-contract';
import type {
  EvidenceStance,
  ExtractedClaim,
  ImageClaimAnalysis,
  ModelClaimAnalysis,
  SourceEvaluation,
  SourceRelevance,
} from '@/core/types';
import type { ValidatedImage } from '@/core/validation';

/**
 * Contracts for external analysis services. Each one is implemented by a backend
 * call (see `remote.ts`) or by `unavailable.ts` when no backend is configured.
 * Swapping models or vendors only requires a new implementation of these.
 */

/** AI claim analysis: extracts, classifies and assesses the central claim of the content. */
export interface ClaimAnalyzer {
  analyzeClaim(request: ClaimAnalysisRequest): Promise<ModelClaimAnalysis>;
}

/** Evidence as returned by retrieval, before on-device source evaluation. */
export interface RetrievedEvidence {
  title: string;
  url: string;
  publisher: string;
  /** Passage quoted from the source. */
  snippet: string;
  stance: EvidenceStance;
  relevance?: SourceRelevance;
  explanation?: string;
  publishedAt?: string;
}

export interface EvidenceSearchResult {
  /** May be empty; never a fixed length. */
  sources: RetrievedEvidence[];
  /** Source-backed evaluation; `null` when no usable sources were found. */
  evaluation: SourceEvaluation | null;
  rejectedSources: number;
}

/** Source discovery + source-backed evaluation for a normalized claim. */
export interface EvidenceRetriever {
  findEvidence(claim: ExtractedClaim): Promise<EvidenceSearchResult>;
}

/**
 * Claude vision: reads the image's text and extracts the claims in it. It does not
 * verify claims; the primary claim goes through the normal claim + source pipeline.
 */
export interface VisionAnalyzer {
  analyzeImage(image: ValidatedImage): Promise<ImageClaimAnalysis>;
}

export interface AnalysisProviders {
  claimAnalyzer: ClaimAnalyzer;
  evidenceRetriever: EvidenceRetriever;
  visionAnalyzer: VisionAnalyzer;
}
