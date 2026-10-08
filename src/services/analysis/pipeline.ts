import type { ClaimAnalysisRequest } from '@/core/api-contract';
import {
  CLAIM_TYPE_LABELS,
  describeEvidenceNeeded,
  extractClaims,
  extractSingleClaim,
  scoreSpecificity,
} from '@/core/claims/claim-extraction';
import {
  AnalysisUnavailableError,
  ServiceUnavailableError,
  ValidationError,
  toUserMessage,
} from '@/core/errors';
import { guardImageAnalysis, primaryImageClaim } from '@/core/image/image-guards';
import { assessTrust } from '@/core/scoring/trust-scoring';
import { detectLanguageSignals } from '@/core/signals/language-signals';
import { evaluateSource } from '@/core/sources/source-evaluation';
import type {
  AnalysisComponent,
  AnalysisKind,
  AnalysisResult,
  ComponentReport,
  EvidenceItem,
  EvidenceStatus,
  ExtractedClaim,
  ImageAuthenticityAnalysis,
  Indicator,
  ImageClaimAnalysis,
  ModelClaimAnalysis,
  OcrResult,
  SourceEvaluation,
  TextReadability,
} from '@/core/types';
import { type ImageInput, validateImageInput, validateTextInput } from '@/core/validation';

import type { AnalysisProviders } from '../providers/types';

/**
 * Orchestrates an analysis: validation → on-device claim extraction + language
 * signals → AI claim analysis (extraction, classification, assessment) →
 * evidence retrieval → source evaluation → trust scoring.
 *
 * Each external step is isolated: if it is unavailable or fails, that is
 * recorded in `components` and the assessment is downgraded accordingly —
 * results are never invented to fill the gap.
 */

/** Coarse progress stages, for the loading UI. */
export type AnalysisStage = 'reading_image' | 'analyzing_claim' | 'checking_sources';

export interface PipelineOptions {
  now?: () => Date;
  createId?: () => string;
  onProgress?: (stage: AnalysisStage) => void;
}

const defaultId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface StepOutcome<T> {
  value: T | null;
  report: ComponentReport;
}

async function runStep<T>(
  component: AnalysisComponent,
  task: () => Promise<T>,
): Promise<StepOutcome<T>> {
  try {
    return { value: await task(), report: { component, status: 'completed' } };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      return { value: null, report: { component, status: 'unavailable', detail: error.message } };
    }
    return { value: null, report: { component, status: 'failed', detail: toUserMessage(error) } };
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const skipped = (component: AnalysisComponent, detail: string): ComponentReport => ({
  component,
  status: 'skipped',
  detail,
});

interface Verification {
  claim: ExtractedClaim | null;
  model: ModelClaimAnalysis | null;
  evidence: EvidenceItem[];
  evidenceStatus: EvidenceStatus;
  sourceEvaluation: SourceEvaluation | null;
  reports: ComponentReport[];
}

/** The model's restatement of the claim replaces the on-device heuristic when available. */
function claimFromModel(
  model: ModelClaimAnalysis,
  fallback: ExtractedClaim | null,
): ExtractedClaim | null {
  const text = model.extractedClaim || fallback?.text;
  if (!text) return fallback;
  return {
    text,
    type: model.claimType,
    checkable: model.verifiable,
    specificity: scoreSpecificity(text),
    method: 'model',
  };
}

/**
 * AI analysis of the content, then (for checkable claims) evidence retrieval and
 * source evaluation. Without AI, falls back to the heuristic claim.
 */
async function verifyContent(
  content: ClaimAnalysisRequest | null,
  heuristicClaim: ExtractedClaim | null,
  providers: AnalysisProviders,
  options: PipelineOptions = {},
): Promise<Verification> {
  if (content) options.onProgress?.('analyzing_claim');
  const modelStep = content
    ? await runStep('llm_analysis', () => providers.claimAnalyzer.analyzeClaim(content))
    : null;
  const model = modelStep?.value ?? null;
  const claim = model ? claimFromModel(model, heuristicClaim) : heuristicClaim;
  const modelReport: ComponentReport = !modelStep
    ? skipped('llm_analysis', 'No text to analyze.')
    : model
      ? { ...modelStep.report, detail: `Model: ${model.model}` }
      : modelStep.report;

  if (!claim || !claim.checkable) {
    const reason = !claim
      ? 'No factual claim was found.'
      : `${CLAIM_TYPE_LABELS[claim.type]}: not something that can be fact-checked.`;
    return {
      claim,
      model,
      evidence: [],
      evidenceStatus: 'not_searched',
      sourceEvaluation: null,
      reports: [
        modelReport,
        skipped('evidence_retrieval', reason),
        skipped('source_evaluation', reason),
      ],
    };
  }

  options.onProgress?.('checking_sources');
  const retrieved = await runStep('evidence_retrieval', () =>
    providers.evidenceRetriever.findEvidence(claim),
  );
  const sourceEvaluation = retrieved.value?.evaluation ?? null;

  const evidence: EvidenceItem[] = (retrieved.value?.sources ?? []).map((item, index) => ({
    ...item,
    id: `evidence-${index}`,
    publisher: item.publisher || evaluateSource(item.url).domain,
    source: evaluateSource(item.url),
  }));

  const evidenceStatus: EvidenceStatus =
    retrieved.report.status === 'completed'
      ? evidence.some((item) => item.stance !== 'unrelated')
        ? 'found'
        : 'none_found'
      : retrieved.report.status === 'failed'
        ? 'failed'
        : 'not_searched';

  const sourceReport: ComponentReport =
    evidence.length > 0
      ? {
          component: 'source_evaluation',
          status: 'completed',
          detail: sourceEvaluation
            ? `AI judged ${evidence.length} source(s) against the claim (${sourceEvaluation.model}); outlet credibility rated by outlet type`
            : 'Outlet credibility rated by outlet type',
        }
      : skipped('source_evaluation', 'No sources to evaluate.');

  const retrievalReport: ComponentReport =
    retrieved.report.status === 'completed'
      ? {
          ...retrieved.report,
          detail:
            evidence.length === 0
              ? 'Web search ran but found no usable sources.'
              : `${evidence.length} source(s) found${retrieved.value?.rejectedSources ? `; ${retrieved.value.rejectedSources} rejected (invalid or unsafe links)` : ''}`,
        }
      : retrieved.report;

  return {
    claim,
    model,
    evidence,
    evidenceStatus,
    sourceEvaluation,
    reports: [modelReport, retrievalReport, sourceReport],
  };
}

function claimExtractionReport(claim: ExtractedClaim | null, source: string): ComponentReport {
  return {
    component: 'claim_extraction',
    status: 'completed',
    detail: claim?.method === 'model' ? `AI model (${source})` : `On-device heuristic (${source})`,
  };
}

function buildReasoning(params: {
  claim: ExtractedClaim | null;
  indicators: Indicator[];
  verification: Verification;
  authenticity: ImageAuthenticityAnalysis | null;
}): string[] {
  const { claim, indicators, verification, authenticity } = params;
  const { model } = verification;
  const lines: string[] = [];

  if (model?.reasoning) {
    lines.push(model.reasoning);
  } else {
    const modelReport = verification.reports.find((r) => r.component === 'llm_analysis');
    if (modelReport?.status === 'unavailable' || modelReport?.status === 'failed') {
      lines.push(
        `AI analysis did not run (${modelReport.detail ?? 'unavailable'}), so only on-device checks were used.`,
      );
    }
  }
  if (model && !model.verifiable && model.verifiabilityNote) {
    lines.push(model.verifiabilityNote);
  }
  if (claim) {
    const who =
      claim.method === 'model'
        ? 'The AI classified the main claim'
        : 'The main statement was classified on-device';
    lines.push(
      `${who} as: ${CLAIM_TYPE_LABELS[claim.type].toLowerCase()}` +
        (claim.specificity < 0.35 && claim.checkable
          ? '. It is fairly vague, which makes it harder to verify.'
          : '.'),
    );
  }
  if (model?.limitations) {
    lines.push(`Limitations: ${model.limitations}`);
  }

  const concerns = indicators.filter(
    (indicator) => indicator.origin === 'heuristic' && indicator.direction === 'raises_concern',
  );
  if (concerns.length > 0) {
    lines.push(
      `The wording shows ${concerns.length} pattern(s) common in misleading content (${concerns
        .map((indicator) => indicator.label.toLowerCase())
        .join(', ')}). This concerns how it is written, not whether it is true.`,
    );
  }

  switch (verification.evidenceStatus) {
    case 'found': {
      const relevant = verification.evidence.filter((item) => item.stance !== 'unrelated');
      const supports = relevant.filter((item) => item.stance === 'supports').length;
      const contradicts = relevant.filter((item) => item.stance === 'contradicts').length;
      const context = relevant.length - supports - contradicts;
      lines.push(
        `Of ${plural(relevant.length, 'source')} found, ${supports} ${supports === 1 ? 'supports' : 'support'} the claim, ${contradicts} ${contradicts === 1 ? 'contradicts' : 'contradict'} it and ${context} ${context === 1 ? 'provides' : 'provide'} context.`,
      );
      break;
    }
    case 'none_found':
      lines.push('A web search ran but found no usable sources about this claim.');
      break;
    case 'failed':
      lines.push(
        'External source checking failed, so the claim has not been checked against independent sources.',
      );
      break;
    case 'not_searched':
      if (claim?.checkable) {
        lines.push(
          'Evidence search is not connected yet, so the claim has not been checked against independent sources.',
        );
      }
      break;
  }

  if (authenticity) {
    lines.push(
      `Image authenticity was assessed separately: AI-generation likelihood is ${authenticity.aiGeneration.likelihood}, manipulation likelihood is ${authenticity.manipulation.likelihood}.`,
    );
  }

  return lines;
}

function assemble(params: {
  kind: AnalysisKind;
  input: AnalysisResult['input'];
  keyStatements: string[];
  indicators: Indicator[];
  verification: Verification;
  authenticity: ImageAuthenticityAnalysis | null;
  extractedText: OcrResult | null;
  reports: ComponentReport[];
  options: PipelineOptions;
  imageAnalysis?: ImageClaimAnalysis | null;
  /** Parts of the image could not be read reliably; lowers confidence. */
  interpretationUncertain?: boolean;
  /** Why no claim from an image was checked. */
  noClaimReason?: string;
}): AnalysisResult {
  const { verification, authenticity, options } = params;
  const { claim } = verification;
  const indicators = [...params.indicators, ...(verification.model?.indicators ?? [])];

  const assessment = assessTrust({
    claim,
    indicators,
    model: verification.model,
    evidence: verification.evidence,
    evidenceStatus: verification.evidenceStatus,
    authenticity,
    sourceEvaluation: verification.sourceEvaluation,
    interpretationUncertain: params.interpretationUncertain,
  });

  if (params.kind === 'image' && params.noClaimReason) {
    assessment.summary = `${params.noClaimReason} This says nothing about whether anything in the image is true or false.`;
    assessment.recommendation =
      'If the image makes a claim you want checked, enter it with Analyze claim. Check where the image first appeared before sharing it.';
  }

  // Prefer what the source evaluation found missing, then the model's own list.
  const sourceNeeded = verification.sourceEvaluation?.missingEvidence ?? [];
  const modelNeeded =
    sourceNeeded.length > 0 ? sourceNeeded : (verification.model?.evidenceNeeded ?? []);

  return {
    id: (options.createId ?? defaultId)(),
    kind: params.kind,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    input: params.input,
    claim,
    keyStatements: params.keyStatements,
    assessment,
    indicators,
    reasoning: [
      ...(params.interpretationUncertain
        ? [
            'Parts of the image could not be read reliably, so the claim may be incomplete and confidence was reduced.',
          ]
        : []),
      ...buildReasoning({ claim, indicators, verification, authenticity }),
    ],
    evidence: verification.evidence,
    evidenceStatus: verification.evidenceStatus,
    sourceEvaluation: verification.sourceEvaluation,
    evidenceNeeded: modelNeeded.length > 0 ? modelNeeded : describeEvidenceNeeded(claim),
    authenticity,
    extractedText: params.extractedText,
    imageAnalysis: params.imageAnalysis ?? null,
    components: [...params.reports, ...verification.reports],
  };
}

export async function analyzeText(
  rawText: string,
  mode: 'text' | 'claim',
  providers: AnalysisProviders,
  options: PipelineOptions = {},
): Promise<AnalysisResult> {
  const text = validateTextInput(rawText, mode);

  const extraction =
    mode === 'claim'
      ? (() => {
          const claim = extractSingleClaim(text);
          return { claim, keyStatements: claim ? [claim.text] : [] };
        })()
      : extractClaims(text);

  const indicators = detectLanguageSignals(text);
  const verification = await verifyContent({ text, mode }, extraction.claim, providers, options);

  // AI analysis is the core of a text/claim check: if it did not run, show an error
  // the user can retry rather than a degraded result that looks like an assessment.
  if (!verification.model) {
    const report = verification.reports.find((r) => r.component === 'llm_analysis');
    throw new AnalysisUnavailableError(report?.detail ?? 'AI analysis is unavailable right now.');
  }

  return assemble({
    kind: mode,
    input: { text },
    keyStatements: extraction.keyStatements,
    indicators,
    verification,
    authenticity: null,
    extractedText: null,
    reports: [
      claimExtractionReport(verification.claim, 'from your text'),
      { component: 'language_signals', status: 'completed', detail: 'On-device heuristic' },
    ],
    options,
  });
}

const READABILITY_CONFIDENCE: Record<TextReadability, number> = {
  clear: 0.9,
  partial: 0.6,
  unreadable: 0.2,
  no_text: 0,
};

function noClaimReason(reading: ImageClaimAnalysis): string {
  if (reading.readability === 'unreadable') {
    return 'The text in the image could not be read reliably, so no claim could be checked.';
  }
  if (reading.claims.length === 0) {
    return 'No factual claim was found in the image.';
  }
  if (reading.claims.every((claim) => !claim.isFactual || !claim.grounded)) {
    return reading.claims.some((claim) => !claim.grounded) &&
      reading.claims.every((claim) => claim.isFactual)
      ? 'The claims could not be matched to readable text in the image, so they were not checked.'
      : 'The image contains commentary, opinion or humour rather than a checkable factual claim.';
  }
  return 'The claims in the image are opinions or predictions, which cannot be fact-checked.';
}

/**
 * Image analysis: Claude vision reads the image and extracts its claims; the
 * primary claim then goes through exactly the same pipeline as a typed claim
 * (AI claim analysis → source discovery → source-backed evaluation → scoring).
 * Vision failures are errors, never a text-only guess.
 */
export async function analyzeImage(
  rawImage: ImageInput | null | undefined,
  providers: AnalysisProviders,
  options: PipelineOptions = {},
): Promise<AnalysisResult> {
  const image = validateImageInput(rawImage);

  options.onProgress?.('reading_image');
  let reading: ImageClaimAnalysis;
  try {
    reading = guardImageAnalysis(await providers.visionAnalyzer.analyzeImage(image));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new AnalysisUnavailableError(
      error instanceof ServiceUnavailableError
        ? error.message
        : `The image could not be analyzed. ${toUserMessage(error)}`,
    );
  }

  const primary = primaryImageClaim(reading);
  const readable = reading.visibleText.replace(/\[illegible\]/gi, ' ').trim();
  const indicators = readable.length >= 12 ? detectLanguageSignals(readable) : [];
  if (reading.containsInstructions) {
    indicators.push({
      id: 'embedded_instructions',
      label: 'Instructions embedded in the image',
      description:
        'The image contains text that tries to instruct an AI or the reader (for example "ignore previous instructions"). It was treated as data, not followed, and is a warning sign.',
      direction: 'raises_concern',
      weight: 0.35,
      origin: 'model',
    });
  }

  const visionReport: ComponentReport = {
    component: 'vision_analysis',
    status: 'completed',
    detail: `Read by ${reading.model}: text ${reading.readability.replace('_', ' ')}, ${plural(reading.claims.length, 'claim')} found`,
  };

  let verification: Verification;
  if (primary) {
    // Same safeguards as typed text: the claim is re-validated and re-analyzed.
    verification = await verifyContent(
      { text: primary.text, mode: 'claim' },
      extractSingleClaim(primary.text),
      providers,
      options,
    );
    if (!verification.model) {
      const report = verification.reports.find((r) => r.component === 'llm_analysis');
      throw new AnalysisUnavailableError(
        `A claim was read from the image, but AI claim analysis failed: ${report?.detail ?? 'unavailable'}`,
      );
    }
  } else {
    const reason = noClaimReason(reading);
    const shown = reading.claims[0];
    verification = {
      claim: shown
        ? {
            text: shown.text,
            type: shown.claimType,
            checkable: false,
            specificity: scoreSpecificity(shown.text),
            method: 'model',
          }
        : null,
      model: null,
      evidence: [],
      evidenceStatus: 'not_searched',
      sourceEvaluation: null,
      reports: [
        skipped('llm_analysis', reason),
        skipped('evidence_retrieval', reason),
        skipped('source_evaluation', reason),
      ],
    };
  }

  return assemble({
    kind: 'image',
    input: { imageUri: image.uri, text: reading.visibleText || undefined },
    keyStatements: reading.claims.map((claim) => claim.text),
    indicators,
    verification,
    authenticity: null,
    extractedText: reading.visibleText
      ? {
          text: reading.visibleText,
          confidence: READABILITY_CONFIDENCE[reading.readability],
          engine: reading.model,
        }
      : null,
    imageAnalysis: reading,
    interpretationUncertain:
      reading.readability === 'partial' || primary?.readability === 'partial',
    noClaimReason: primary ? undefined : noClaimReason(reading),
    reports: [
      visionReport,
      primary
        ? {
            component: 'claim_extraction',
            status: 'completed',
            detail: `AI vision (claim ${(reading.primaryClaimIndex ?? 0) + 1} of ${reading.claims.length} verified)`,
          }
        : skipped('claim_extraction', noClaimReason(reading)),
      ...(indicators.length > 0 || readable.length >= 12
        ? [
            {
              component: 'language_signals' as const,
              status: 'completed' as const,
              detail: 'On-device heuristic, on the text in the image',
            },
          ]
        : []),
    ],
    options,
  });
}
