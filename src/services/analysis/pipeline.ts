import type { ClaimAnalysisRequest } from '@/core/api-contract';
import {
  CLAIM_TYPE_LABELS,
  describeEvidenceNeeded,
  extractClaims,
  extractSingleClaim,
  scoreSpecificity,
} from '@/core/claims/claim-extraction';
import { AnalysisUnavailableError, ServiceUnavailableError, toUserMessage } from '@/core/errors';
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
  ModelClaimAnalysis,
  OcrResult,
  SourceEvaluation,
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
export type AnalysisStage = 'analyzing_claim' | 'checking_sources';

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
  });

  if (params.kind === 'image' && !claim) {
    assessment.summary =
      'No factual claim was found in this image, so there was nothing to fact-check. See the image authenticity findings.';
    assessment.recommendation =
      'Check where the image first appeared, for example with a reverse image search, before sharing.';
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
    reasoning: buildReasoning({ claim, indicators, verification, authenticity }),
    evidence: verification.evidence,
    evidenceStatus: verification.evidenceStatus,
    sourceEvaluation: verification.sourceEvaluation,
    evidenceNeeded: modelNeeded.length > 0 ? modelNeeded : describeEvidenceNeeded(claim),
    authenticity,
    extractedText: params.extractedText,
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

/** Minimum OCR text needed before treating it as a potential claim. */
const MIN_OCR_TEXT = 12;

export async function analyzeImage(
  rawImage: ImageInput | null | undefined,
  providers: AnalysisProviders,
  options: PipelineOptions = {},
): Promise<AnalysisResult> {
  const image = validateImageInput(rawImage);

  const [vision, ocr] = await Promise.all([
    runStep('vision_analysis', () => providers.visionAnalyzer.analyzeImage(image)),
    runStep('ocr', () => providers.ocr.extractText(image)),
  ]);

  if (!vision.value && !ocr.value) {
    const allUnavailable = [vision, ocr].every((step) => step.report.status === 'unavailable');
    throw new AnalysisUnavailableError(
      allUnavailable
        ? 'Image analysis is not connected yet, so this image cannot be analyzed. No result was generated.'
        : `Image analysis failed: ${vision.report.detail ?? ocr.report.detail ?? 'unknown error'}`,
    );
  }

  const text = ocr.value?.text.trim() ?? '';
  const hasText = text.length >= MIN_OCR_TEXT && text.split(/\s+/).length >= 3;
  const extraction = hasText ? extractClaims(text) : { claim: null, keyStatements: [] };
  const indicators = hasText ? detectLanguageSignals(text) : [];
  const verification = await verifyContent(
    hasText ? { text, mode: 'text' } : null,
    extraction.claim,
    providers,
    options,
  );

  const reports: ComponentReport[] = [
    vision.report,
    ocr.report,
    hasText
      ? claimExtractionReport(verification.claim, 'from text in the image')
      : skipped('claim_extraction', 'No readable text was found in the image.'),
  ];
  if (hasText) {
    reports.push({
      component: 'language_signals',
      status: 'completed',
      detail: 'On-device heuristic',
    });
  }

  return assemble({
    kind: 'image',
    input: {
      imageUri: image.uri.startsWith('blob:') ? undefined : image.uri,
      text: text || undefined,
    },
    keyStatements: extraction.keyStatements,
    indicators,
    verification,
    authenticity: vision.value,
    extractedText: ocr.value,
    reports,
    options,
  });
}
