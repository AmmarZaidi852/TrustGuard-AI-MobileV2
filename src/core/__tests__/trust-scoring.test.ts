import { extractSingleClaim } from '../claims/claim-extraction';
import { assessTrust, evidenceBalance, type ScoringInput } from '../scoring/trust-scoring';
import { detectLanguageSignals } from '../signals/language-signals';
import { evaluateSource } from '../sources/source-evaluation';
import type { EvidenceItem, EvidenceStance, ModelClaimAnalysis } from '../types';

const claim = extractSingleClaim('The WHO reported 1,200 measles cases in Lagos in March 2024.')!;

function evidence(stance: EvidenceStance, url: string): EvidenceItem {
  return {
    id: url,
    title: 't',
    url,
    publisher: 'p',
    snippet: '',
    stance,
    source: evaluateSource(url),
  };
}

function model(stance: ModelClaimAnalysis['stance'], confidence = 0.85): ModelClaimAnalysis {
  return {
    extractedClaim: claim.text,
    claimType: claim.type,
    verifiable: true,
    verifiabilityNote: '',
    stance,
    confidence,
    reasoning: '',
    indicators: [],
    evidenceNeeded: [],
    limitations: '',
    model: 'm',
  };
}

const base: ScoringInput = {
  claim,
  indicators: [],
  model: null,
  evidence: [],
  evidenceStatus: 'not_searched',
  authenticity: null,
};

describe('assessTrust', () => {
  it('does not score or judge when no verification signal is available', () => {
    const result = assessTrust({
      ...base,
      indicators: detectLanguageSignals('SHOCKING!!! Share this before it is deleted!!!'),
    });
    expect(result.score).toBeNull();
    expect(result.label).toBe('cannot_verify');
    expect(result.confidence).toBeLessThanOrEqual(0.25);
    expect(result.summary).toMatch(/does not mean it is false/);
  });

  it('separates "searched and found nothing" from "could not search"', () => {
    expect(assessTrust({ ...base, evidenceStatus: 'none_found' }).label).toBe(
      'insufficient_evidence',
    );
    expect(assessTrust({ ...base, evidenceStatus: 'failed' }).label).toBe('cannot_verify');
  });

  it('never fact-checks opinions or predictions', () => {
    const opinion = extractSingleClaim('I think this is the best city in the world.')!;
    const result = assessTrust({
      ...base,
      claim: opinion,
      model: model('contradicted'),
      evidence: [evidence('contradicts', 'https://reuters.com/a')],
    });
    expect(result.label).toBe('cannot_verify');
    expect(result.summary).toMatch(/opinion/);
  });

  it('labels a claim likely false only with strong, credible contradicting signals', () => {
    const result = assessTrust({
      ...base,
      model: model('contradicted'),
      evidenceStatus: 'found',
      evidence: [
        evidence('contradicts', 'https://www.cdc.gov/a'),
        evidence('contradicts', 'https://www.snopes.com/b'),
        evidence('contradicts', 'https://apnews.com/c'),
        evidence('supports', 'https://x.com/d'),
      ],
    });
    expect(result.label).toBe('likely_false');
    expect(result.riskLevel).toBe('high');
    expect(result.score).toBeLessThan(30);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it('labels a claim likely reliable with strong, credible support', () => {
    const result = assessTrust({
      ...base,
      model: model('supported'),
      evidenceStatus: 'found',
      evidence: [
        evidence('supports', 'https://www.who.int/a'),
        evidence('supports', 'https://www.reuters.com/b'),
        evidence('supports', 'https://www.bbc.com/c'),
      ],
    });
    expect(result.label).toBe('likely_reliable');
    expect(result.riskLevel).toBe('low');
  });

  it('does not reach a strong label from one weak signal', () => {
    const result = assessTrust({
      ...base,
      claim: { ...claim, specificity: 0.1 },
      model: model('supported', 0.3),
    });
    expect(result.label).not.toBe('likely_reliable');
    expect(result.confidence).toBeLessThan(0.55);
  });

  it('reports mixed evidence as needing verification', () => {
    const result = assessTrust({
      ...base,
      model: model('disputed', 0.6),
      evidenceStatus: 'found',
      evidence: [
        evidence('supports', 'https://www.reuters.com/a'),
        evidence('contradicts', 'https://apnews.com/b'),
      ],
    });
    expect(result.label).toBe('needs_verification');
  });

  it('maps a model "unverifiable" verdict to cannot verify, or insufficient evidence after a search', () => {
    const notSearched = assessTrust({ ...base, model: model('unverifiable', 0.7) });
    expect(notSearched.label).toBe('cannot_verify');
    expect(notSearched.summary).toMatch(/does not mean it is false/);

    const searched = assessTrust({
      ...base,
      model: model('unverifiable', 0.7),
      evidenceStatus: 'none_found',
    });
    expect(searched.label).toBe('insufficient_evidence');
  });

  describe('model-only analysis (no independent evidence)', () => {
    const veryCertainSpecificClaim = { ...claim, specificity: 1 };

    it('never produces "Likely false", even at maximum confidence', () => {
      const result = assessTrust({
        ...base,
        claim: veryCertainSpecificClaim,
        model: model('contradicted', 0.9),
      });
      expect(result.label).toBe('possibly_misleading');
      expect(result.summary).toMatch(/No independent sources were checked/);
      expect(result.riskLevel).toBe('high');
    });

    it('never produces "Likely reliable", even at maximum confidence', () => {
      const result = assessTrust({
        ...base,
        claim: veryCertainSpecificClaim,
        model: model('supported', 0.9),
      });
      expect(result.label).toBe('needs_verification');
      expect(result.summary).toMatch(/not confirmed/);
    });

    it('treats a disputed claim as possibly misleading or needing verification', () => {
      const result = assessTrust({ ...base, model: model('disputed', 0.6) });
      expect(['possibly_misleading', 'needs_verification']).toContain(result.label);
      expect(result.summary).toMatch(/disputed/);
    });

    it('lets low model confidence pull the score towards neutral', () => {
      const confident = assessTrust({ ...base, model: model('contradicted', 0.9) });
      const unsure = assessTrust({ ...base, model: model('contradicted', 0.1) });
      expect(unsure.score!).toBeGreaterThan(confident.score!);
      expect(unsure.confidence).toBeLessThan(confident.confidence);
    });
  });

  it('explains claims that are too vague to check', () => {
    const result = assessTrust({
      ...base,
      claim: { ...claim, type: 'factual', checkable: false },
    });
    expect(result.label).toBe('cannot_verify');
    expect(result.summary).toMatch(/too vague/);
  });

  it('exposes every factor transparently, with unavailable ones marked null', () => {
    const { factors } = assessTrust(base);
    expect(factors.map((f) => f.id)).toEqual([
      'model_assessment',
      'source_backed_assessment',
      'evidence_balance',
      'source_credibility',
      'language_signals',
    ]);
    expect(factors.find((f) => f.id === 'model_assessment')?.value).toBeNull();
    factors.forEach((f) => expect(f.explanation.length).toBeGreaterThan(0));
  });
});

describe('evidenceBalance', () => {
  it('weights evidence by source credibility and ignores unrelated items', () => {
    expect(evidenceBalance([])).toBeNull();
    expect(evidenceBalance([evidence('unrelated', 'https://cdc.gov')])).toBeNull();
    const balance = evidenceBalance([
      evidence('contradicts', 'https://www.cdc.gov/a'),
      evidence('supports', 'https://x.com/b'),
    ])!;
    expect(balance).toBeLessThan(0.5);
  });
});
