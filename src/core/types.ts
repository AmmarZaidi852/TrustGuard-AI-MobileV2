/**
 * Domain model for TrustGuardAI analyses.
 *
 * Design rule: an analysis is a set of *separate* findings — claim verification,
 * content authenticity, source credibility and evidence availability — that are
 * combined transparently. None of them alone is treated as proof.
 */

export type AnalysisKind = 'text' | 'claim' | 'image';

/**
 * Claim-level assessment labels. These describe how well the available signals
 * support a claim — never an absolute verdict.
 */
export type AssessmentLabel =
  | 'likely_reliable'
  | 'possibly_misleading'
  | 'needs_verification'
  | 'likely_false'
  /** Verification could not be performed (no service, or the claim is not checkable). */
  | 'cannot_verify'
  /** Verification ran, but too little relevant evidence was found. */
  | 'insufficient_evidence';

export type RiskLevel = 'low' | 'moderate' | 'high' | 'unknown';

export type ClaimType =
  | 'factual'
  | 'statistical'
  | 'scientific_health'
  | 'event_news'
  | 'quote_attribution'
  | 'opinion'
  | 'prediction'
  | 'unknown';

/** Where a piece of information came from. Heuristics are never presented as model output. */
export type SignalOrigin = 'heuristic' | 'model' | 'evidence';

export interface ExtractedClaim {
  text: string;
  type: ClaimType;
  /** Whether the claim can, in principle, be checked against evidence today. */
  checkable: boolean;
  /** 0..1 — how concrete the claim is (numbers, dates, named entities, attributed sources). */
  specificity: number;
  method: SignalOrigin;
}

export interface Indicator {
  id: string;
  label: string;
  description: string;
  direction: 'raises_concern' | 'supports_reliability';
  /** 0..1 strength of this single indicator. */
  weight: number;
  origin: SignalOrigin;
  excerpt?: string;
}

export type SourceCategory =
  | 'government'
  | 'academic'
  | 'fact_checker'
  | 'established_news'
  | 'reference'
  | 'user_generated'
  | 'unknown';

export interface SourceAssessment {
  domain: string;
  category: SourceCategory;
  /** 0..1 heuristic credibility of the *outlet type*, not of the specific article. */
  credibility: number;
  rationale: string;
}

export type EvidenceStance = 'supports' | 'contradicts' | 'mixed' | 'unrelated';

export interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  stance: EvidenceStance;
  publishedAt?: string;
  source: SourceAssessment;
}

/** Verification status of the evidence step, shown to the user as-is. */
export type EvidenceStatus = 'found' | 'none_found' | 'not_searched' | 'failed';

/** Output of an LLM claim analysis (provided by the backend in a later phase). */
export interface ModelClaimAnalysis {
  stance: 'supported' | 'contradicted' | 'disputed' | 'unverifiable';
  /** 0..1 self-reported model confidence; treated as one signal, not ground truth. */
  confidence: number;
  reasoning: string;
  indicators: Indicator[];
  evidenceNeeded: string[];
  model: string;
}

export type Likelihood = 'low' | 'moderate' | 'high' | 'undetermined';

export interface AuthenticityFinding {
  likelihood: Likelihood;
  /** Concrete observable signals behind the likelihood. Required — no bare verdicts. */
  signals: string[];
}

/** Output of a vision model. Authenticity is assessed separately from claim truth. */
export interface ImageAuthenticityAnalysis {
  aiGeneration: AuthenticityFinding;
  manipulation: AuthenticityFinding;
  misleadingContext: AuthenticityFinding;
  description: string;
  model: string;
}

export interface OcrResult {
  text: string;
  /** 0..1 */
  confidence: number;
  engine: string;
}

export type AnalysisComponent =
  | 'claim_extraction'
  | 'language_signals'
  | 'llm_analysis'
  | 'evidence_retrieval'
  | 'source_evaluation'
  | 'vision_analysis'
  | 'ocr';

export type ComponentStatus = 'completed' | 'unavailable' | 'failed' | 'skipped';

export interface ComponentReport {
  component: AnalysisComponent;
  status: ComponentStatus;
  detail?: string;
}

export type TrustFactorId =
  | 'model_assessment'
  | 'evidence_balance'
  | 'source_credibility'
  | 'language_signals'
  | 'ai_generation'
  | 'manipulation';

export interface TrustFactor {
  id: TrustFactorId;
  label: string;
  /** 0..1 where 1 favours trust. `null` when the signal was not available. */
  value: number | null;
  weight: number;
  explanation: string;
}

export interface TrustAssessment {
  label: AssessmentLabel;
  /** 0..100, or `null` when no verification signal (evidence or model) was available. */
  score: number | null;
  /** 0..1 — how much signal the assessment rests on. Not the probability the claim is true. */
  confidence: number;
  riskLevel: RiskLevel;
  factors: TrustFactor[];
  summary: string;
  recommendation: string;
}

export interface AnalysisInput {
  text?: string;
  imageUri?: string;
}

export interface AnalysisResult {
  id: string;
  kind: AnalysisKind;
  createdAt: string;
  input: AnalysisInput;
  claim: ExtractedClaim | null;
  keyStatements: string[];
  assessment: TrustAssessment;
  indicators: Indicator[];
  reasoning: string[];
  evidence: EvidenceItem[];
  evidenceStatus: EvidenceStatus;
  evidenceNeeded: string[];
  authenticity: ImageAuthenticityAnalysis | null;
  extractedText: OcrResult | null;
  components: ComponentReport[];
}
