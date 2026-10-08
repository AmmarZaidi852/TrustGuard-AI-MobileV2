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

/**
 * How a source relates to the claim. `context` = relevant background that neither
 * supports nor contradicts it. `mixed` is kept for older stored results.
 */
export type EvidenceStance = 'supports' | 'contradicts' | 'context' | 'mixed' | 'unrelated';

export type SourceRelevance = 'high' | 'medium' | 'low';

export interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  /** Text quoted from the source itself (provider citation), not written by the model. */
  snippet: string;
  stance: EvidenceStance;
  /** Absent on results stored before source-backed verification existed. */
  relevance?: SourceRelevance;
  /** Short explanation of why the source is relevant to the claim. */
  explanation?: string;
  publishedAt?: string;
  source: SourceAssessment;
}

/** Verification status of the evidence step, shown to the user as-is. */
export type EvidenceStatus = 'found' | 'none_found' | 'not_searched' | 'failed';

export type SourceVerdict =
  'supported' | 'contradicted' | 'mixed' | 'insufficient_evidence' | 'cannot_verify';

/**
 * Source-backed evaluation of a claim: the model's reading of the retrieved
 * sources, after code-level guard rails (see `core/evidence/source-guards.ts`).
 */
export interface SourceEvaluation {
  verdict: SourceVerdict;
  /** 0..1, capped like all model confidence. */
  confidence: number;
  /** What the sources actually state. */
  whatSourcesSay: string;
  /** What can reasonably be inferred from them about the claim. */
  inference: string;
  /** What remains uncertain or unaddressed. */
  uncertainty: string;
  missingEvidence: string[];
  /** Search queries the model ran, for transparency. */
  searchQueries: string[];
  model: string;
}

/** Output of an LLM claim analysis (provided by the backend in a later phase). */
export type ModelStance = 'supported' | 'contradicted' | 'disputed' | 'unverifiable';

export const CLAIM_TYPES: readonly ClaimType[] = [
  'factual',
  'statistical',
  'scientific_health',
  'event_news',
  'quote_attribution',
  'opinion',
  'prediction',
  'unknown',
];

/**
 * Output of the AI claim analysis (served by the backend). The model's stance is
 * one signal among several: it never sets the final assessment label on its own.
 */
export interface ModelClaimAnalysis {
  /** The central factual claim, restated neutrally by the model. */
  extractedClaim: string;
  claimType: ClaimType;
  /** Whether the claim can be fact-checked at all (false for opinions, predictions, vague claims). */
  verifiable: boolean;
  verifiabilityNote: string;
  stance: ModelStance;
  /** 0..1 self-reported model confidence; treated as one signal, not ground truth. */
  confidence: number;
  reasoning: string;
  /** Key findings, as indicators with origin `model`. */
  indicators: Indicator[];
  evidenceNeeded: string[];
  /** What the model could not assess (e.g. events after its training data). */
  limitations: string;
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

export type ImageKind =
  | 'social_post_screenshot'
  | 'news_screenshot'
  | 'meme'
  | 'infographic'
  | 'chart'
  | 'photo_with_text'
  | 'photo'
  | 'document'
  | 'other';

/** How reliably the text in the image could be read. */
export type TextReadability = 'clear' | 'partial' | 'unreadable' | 'no_text';

export interface ImageClaim {
  /** The claim restated as a standalone sentence. */
  text: string;
  claimType: ClaimType;
  /** Presented as fact in the image (not a joke, caption, opinion or prediction). */
  isFactual: boolean;
  readability: 'clear' | 'partial';
  /** Context visible in the image needed to understand the claim (who posted, date, chart labels). */
  context: string;
  /** The exact visible text the claim is based on, from the transcription. */
  quote: string;
  /** Set by the guard rails: the quote really appears in the transcribed text. */
  grounded: boolean;
  /** Set by the guard rails: factual, grounded and checkable. */
  checkable: boolean;
}

/** Claude vision reading of an image: what it shows, its text and the claims in it. */
export interface ImageClaimAnalysis {
  imageKind: ImageKind;
  /** Short neutral description of what the image shows. */
  description: string;
  /** Transcription of visible text; unreadable parts are marked [illegible]. */
  visibleText: string;
  readability: TextReadability;
  /** At most `MAX_IMAGE_CLAIMS`, in the order they appear. */
  claims: ImageClaim[];
  /** Index of the claim that is verified, or `null` when no claim is checkable. */
  primaryClaimIndex: number | null;
  /** The image contains text that tries to instruct an AI/reader (treated as a warning sign). */
  containsInstructions: boolean;
  /** What could not be interpreted reliably. */
  uncertainty: string;
  model: string;
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
  | 'source_backed_assessment'
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
  /** Optional: results stored before source-backed verification do not have it. */
  sourceEvaluation?: SourceEvaluation | null;
  evidenceNeeded: string[];
  authenticity: ImageAuthenticityAnalysis | null;
  extractedText: OcrResult | null;
  /** How the image was read (image analyses only). The image itself is never stored. */
  imageAnalysis?: ImageClaimAnalysis | null;
  components: ComponentReport[];
}
