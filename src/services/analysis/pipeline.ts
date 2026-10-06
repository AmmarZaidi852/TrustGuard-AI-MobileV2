import {
  CLAIM_TYPE_LABELS,
  describeEvidenceNeeded,
  extractClaims,
  extractSingleClaim,
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
} from '@/core/types';
import { type ImageInput, validateImageInput, validateTextInput } from '@/core/validation';

import type { AnalysisProviders } from '../providers/types';

/**
 * Orchestrates an analysis: validation → claim extraction → language signals →
 * model analysis + evidence retrieval → source evaluation → trust scoring.
 *
 * Each external step is isolated: if it is unavailable or fails, that is
 * recorded in `components` and the assessment is downgraded accordingly —
 * results are never invented to fill the gap.
 */

export interface PipelineOptions {
  now?: () => Date;
  createId?: () => string;
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

const skipped = (component: AnalysisComponent, detail: string): ComponentReport => ({
  component,
  status: 'skipped',
  detail,
});

interface Verification {
  model: ModelClaimAnalysis | null;
  evidence: EvidenceItem[];
  evidenceStatus: EvidenceStatus;
  reports: ComponentReport[];
}

async function verifyClaim(
  claim: ExtractedClaim | null,
  context: string,
  providers: AnalysisProviders,
): Promise<Verification> {
  if (!claim || !claim.checkable) {
    const reason = !claim
      ? 'No factual claim was found.'
      : `${CLAIM_TYPE_LABELS[claim.type]}s cannot be fact-checked.`;
    return {
      model: null,
      evidence: [],
      evidenceStatus: 'not_searched',
      reports: [
        skipped('llm_analysis', reason),
        skipped('evidence_retrieval', reason),
        skipped('source_evaluation', reason),
      ],
    };
  }

  const [model, retrieved] = await Promise.all([
    runStep('llm_analysis', () => providers.claimAnalyzer.analyzeClaim(claim, context)),
    runStep('evidence_retrieval', () => providers.evidenceRetriever.findEvidence(claim)),
  ]);

  const evidence: EvidenceItem[] = (retrieved.value ?? []).map((item, index) => ({
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
      ? { component: 'source_evaluation', status: 'completed', detail: 'Heuristic, by outlet type' }
      : skipped('source_evaluation', 'No sources to evaluate.');

  return {
    model: model.value,
    evidence,
    evidenceStatus,
    reports: [model.report, retrieved.report, sourceReport],
  };
}

function buildReasoning(params: {
  claim: ExtractedClaim | null;
  indicators: Indicator[];
  verification: Verification;
  authenticity: ImageAuthenticityAnalysis | null;
}): string[] {
  const { claim, indicators, verification, authenticity } = params;
  const lines: string[] = [];

  if (verification.model?.reasoning) {
    lines.push(verification.model.reasoning);
  }
  if (claim) {
    lines.push(
      `The main statement was classified as: ${CLAIM_TYPE_LABELS[claim.type].toLowerCase()}` +
        (claim.specificity < 0.35 ? '. It is vague, which makes it harder to verify.' : '.'),
    );
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
      lines.push(
        `Of ${relevant.length} relevant source(s), ${supports} support and ${contradicts} contradict the claim.`,
      );
      break;
    }
    case 'none_found':
      lines.push('An evidence search ran but found no relevant sources.');
      break;
    case 'failed':
      lines.push('The evidence search failed, so no sources could be checked.');
      break;
    case 'not_searched':
      if (claim?.checkable) {
        lines.push(
          'No evidence search was available, so the claim has not been checked against sources.',
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
  claim: ExtractedClaim | null;
  keyStatements: string[];
  indicators: Indicator[];
  verification: Verification;
  authenticity: ImageAuthenticityAnalysis | null;
  extractedText: OcrResult | null;
  reports: ComponentReport[];
  options: PipelineOptions;
}): AnalysisResult {
  const { claim, verification, authenticity, options } = params;
  const indicators = [...params.indicators, ...(verification.model?.indicators ?? [])];

  const assessment = assessTrust({
    claim,
    indicators,
    model: verification.model,
    evidence: verification.evidence,
    evidenceStatus: verification.evidenceStatus,
    authenticity,
  });

  if (params.kind === 'image' && !claim) {
    assessment.summary =
      'No factual claim was found in this image, so there was nothing to fact-check. See the image authenticity findings.';
    assessment.recommendation =
      'Check where the image first appeared, for example with a reverse image search, before sharing.';
  }

  const modelNeeded = verification.model?.evidenceNeeded ?? [];

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
  const verification = await verifyClaim(extraction.claim, text, providers);

  return assemble({
    kind: mode,
    input: { text },
    claim: extraction.claim,
    keyStatements: extraction.keyStatements,
    indicators,
    verification,
    authenticity: null,
    extractedText: null,
    reports: [
      { component: 'claim_extraction', status: 'completed', detail: 'On-device heuristic' },
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
  const verification = await verifyClaim(extraction.claim, text, providers);

  const reports: ComponentReport[] = [
    vision.report,
    ocr.report,
    hasText
      ? { component: 'claim_extraction', status: 'completed', detail: 'From text in the image' }
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
    claim: extraction.claim,
    keyStatements: extraction.keyStatements,
    indicators,
    verification,
    authenticity: vision.value,
    extractedText: ocr.value,
    reports,
    options,
  });
}
