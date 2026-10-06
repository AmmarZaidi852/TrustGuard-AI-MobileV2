import type {
  AnalysisResult,
  AssessmentLabel,
  ComponentStatus,
  AnalysisComponent,
  Likelihood,
  RiskLevel,
} from './types';

/**
 * User-facing wording. Kept separate from the UI so it can be tested, and so the
 * three distinct questions — is the claim supported, is the content authentic,
 * is there evidence — are always phrased separately.
 */

export type Tone = 'positive' | 'caution' | 'negative' | 'neutral' | 'info';

export const ASSESSMENT_META: Record<AssessmentLabel, { title: string; tone: Tone }> = {
  likely_reliable: { title: 'Likely reliable', tone: 'positive' },
  possibly_misleading: { title: 'Possibly misleading', tone: 'caution' },
  needs_verification: { title: 'Needs verification', tone: 'info' },
  likely_false: { title: 'Likely false', tone: 'negative' },
  cannot_verify: { title: 'Cannot verify', tone: 'neutral' },
  insufficient_evidence: { title: 'Insufficient evidence', tone: 'neutral' },
};

export const RISK_META: Record<RiskLevel, { title: string; tone: Tone }> = {
  low: { title: 'Low risk', tone: 'positive' },
  moderate: { title: 'Moderate risk', tone: 'caution' },
  high: { title: 'High risk', tone: 'negative' },
  unknown: { title: 'Risk unknown', tone: 'neutral' },
};

export const COMPONENT_LABELS: Record<AnalysisComponent, string> = {
  claim_extraction: 'Claim extraction',
  language_signals: 'Language signals',
  llm_analysis: 'AI claim analysis',
  evidence_retrieval: 'Evidence search',
  source_evaluation: 'Source evaluation',
  vision_analysis: 'Image authenticity model',
  ocr: 'Text in image (OCR)',
};

export const COMPONENT_STATUS_LABELS: Record<ComponentStatus, string> = {
  completed: 'Ran',
  unavailable: 'Not connected',
  failed: 'Failed',
  skipped: 'Not needed',
};

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return 'High';
  if (confidence >= 0.5) return 'Moderate';
  if (confidence >= 0.3) return 'Low';
  return 'Very low';
}

export interface Dimension {
  key: 'claim' | 'authenticity' | 'evidence';
  question: string;
  answer: string;
  tone: Tone;
}

export function describeClaimVerification(result: AnalysisResult): Dimension {
  const { claim, assessment } = result;
  const question = 'Is the claim supported?';
  if (!claim) {
    return {
      key: 'claim',
      question,
      answer: 'No factual claim was found to check.',
      tone: 'neutral',
    };
  }
  const meta = ASSESSMENT_META[assessment.label];
  const answers: Record<AssessmentLabel, string> = {
    likely_reliable: 'The claim appears to be supported by the available evidence.',
    possibly_misleading: 'The claim may be misleading or missing important context.',
    needs_verification: 'The signals are mixed. The claim needs further verification.',
    likely_false: 'The claim appears to be false based on the available evidence.',
    cannot_verify: 'The claim cannot currently be verified.',
    insufficient_evidence: 'Not enough evidence was found to assess the claim.',
  };
  return { key: 'claim', question, answer: answers[assessment.label], tone: meta.tone };
}

const LIKELIHOOD_TONE: Record<Likelihood, Tone> = {
  low: 'positive',
  moderate: 'caution',
  high: 'negative',
  undetermined: 'neutral',
};

export function describeAuthenticity(result: AnalysisResult): Dimension | null {
  if (result.kind !== 'image') return null;
  const question = 'Does the image appear authentic?';
  const finding = result.authenticity;
  if (!finding) {
    const report = result.components.find((c) => c.component === 'vision_analysis');
    return {
      key: 'authenticity',
      question,
      answer:
        report?.status === 'failed'
          ? 'The image authenticity check failed, so AI generation or editing was not assessed.'
          : 'The image authenticity check is not connected, so AI generation or editing was not assessed.',
      tone: 'neutral',
    };
  }
  const ai = finding.aiGeneration.likelihood;
  const edit = finding.manipulation.likelihood;
  const worst: Likelihood = [ai, edit].includes('high')
    ? 'high'
    : [ai, edit].includes('moderate')
      ? 'moderate'
      : ai === 'undetermined' && edit === 'undetermined'
        ? 'undetermined'
        : 'low';

  const answers: Record<Likelihood, string> = {
    high: 'The image shows several characteristics commonly associated with AI generation or editing. This cannot be confirmed with certainty.',
    moderate:
      'The image shows some characteristics that can indicate AI generation or editing. The evidence is not conclusive.',
    low: 'No strong signs of AI generation or editing were found. That does not prove the image is authentic or used in its original context.',
    undetermined: 'The model could not determine whether the image was AI-generated or edited.',
  };
  return { key: 'authenticity', question, answer: answers[worst], tone: LIKELIHOOD_TONE[worst] };
}

export function describeEvidence(result: AnalysisResult): Dimension {
  const question = 'What evidence is available?';
  const relevant = result.evidence.filter((item) => item.stance !== 'unrelated');
  switch (result.evidenceStatus) {
    case 'found':
      return {
        key: 'evidence',
        question,
        answer: `${relevant.length} relevant source(s) found. See the Evidence section.`,
        tone: 'info',
      };
    case 'none_found':
      return {
        key: 'evidence',
        question,
        answer:
          'A search ran, but no relevant sources were found. This does not mean the claim is false.',
        tone: 'neutral',
      };
    case 'failed':
      return {
        key: 'evidence',
        question,
        answer: 'The evidence search failed, so no sources were checked.',
        tone: 'caution',
      };
    case 'not_searched':
      return {
        key: 'evidence',
        question,
        answer: result.claim?.checkable
          ? 'Evidence search is not connected, so no sources were checked.'
          : 'No evidence search was needed for this content.',
        tone: 'neutral',
      };
  }
}

export function resultTitle(result: AnalysisResult): string {
  return (
    result.claim?.text ??
    result.input.text ??
    (result.kind === 'image' ? 'Image analysis' : 'Analysis')
  );
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

/** "a", "a and b", "a, b and c" */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
