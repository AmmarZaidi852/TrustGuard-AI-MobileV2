import {
  classifyClaim,
  describeEvidenceNeeded,
  extractClaims,
  extractSingleClaim,
  scoreSpecificity,
} from '../claims/claim-extraction';

describe('extractClaims', () => {
  it('strips headline tags and finds the main claim', () => {
    const { claim } = extractClaims(
      'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.',
    );
    expect(claim?.text).toBe(
      'Scientists have confirmed that drinking coffee completely prevents cancer.',
    );
    expect(claim?.type).toBe('scientific_health');
    expect(claim?.checkable).toBe(true);
    expect(claim?.method).toBe('heuristic');
  });

  it('prefers factual statements over questions and calls to share', () => {
    const { claim, keyStatements } = extractClaims(
      'Can you believe this? The city council banned cars from downtown Oslo in March 2024. Share this with everyone!',
    );
    expect(claim?.text).toContain('banned cars');
    expect(keyStatements).not.toContain('Can you believe this?');
  });

  it('returns no claim for empty content', () => {
    expect(extractClaims('ok')).toEqual({ claim: null, keyStatements: [] });
  });
});

describe('classifyClaim', () => {
  it.each([
    ['NASA discovered life on Mars.', 'scientific_health'],
    ['Unemployment rose to 7.5% last quarter.', 'statistical'],
    ['I think pineapple pizza is the best food.', 'opinion'],
    ['The stock market will crash next year.', 'prediction'],
    ['The prime minister resigned yesterday.', 'event_news'],
    ['"We will never surrender," the senator said.', 'quote_attribution'],
  ])('%s → %s', (text, type) => {
    expect(classifyClaim(text)).toBe(type);
  });

  it('marks opinions and predictions as not checkable', () => {
    expect(extractSingleClaim('I think this is the best phone ever made.')?.checkable).toBe(false);
    expect(extractSingleClaim('Bitcoin will hit one million dollars by 2030.')?.checkable).toBe(
      false,
    );
  });
});

test('specific claims score higher than vague ones', () => {
  expect(scoreSpecificity('The WHO reported 1,200 cases in Lagos in March 2024.')).toBeGreaterThan(
    scoreSpecificity('Some people say things are getting worse.'),
  );
});

test('evidence guidance depends on claim type', () => {
  const health = describeEvidenceNeeded(extractSingleClaim('Coffee prevents cancer in adults.'));
  expect(health.join(' ')).toMatch(/peer-reviewed/i);
  expect(describeEvidenceNeeded(null).length).toBeGreaterThan(0);
});
