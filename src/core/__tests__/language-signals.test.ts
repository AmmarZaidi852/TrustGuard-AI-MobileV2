import { detectLanguageSignals, languageConcernIntensity } from '../signals/language-signals';

const ids = (text: string) => detectLanguageSignals(text).map((i) => i.id);

describe('detectLanguageSignals', () => {
  it('flags sensational, absolute and vague-authority framing', () => {
    const found = ids(
      'BREAKING: Scientists have confirmed that drinking coffee completely prevents cancer.',
    );
    expect(found).toEqual(
      expect.arrayContaining(['sensational_framing', 'absolute_language', 'vague_authority']),
    );
  });

  it('flags share pressure, suppression narratives and shouting', () => {
    const found = ids("THEY DON'T WANT YOU TO KNOW THIS!!! SHARE THIS BEFORE IT'S DELETED");
    expect(found).toEqual(
      expect.arrayContaining([
        'conspiracy_framing',
        'urgency_or_share_pressure',
        'excessive_capitals',
        'excessive_punctuation',
      ]),
    );
  });

  it('finds nothing concerning in neutral reporting and credits cited sources', () => {
    const indicators = detectLanguageSignals(
      'According to the Office for National Statistics, inflation was 3.2% in March.',
    );
    expect(indicators.map((i) => i.id)).toEqual(['cites_source']);
    expect(indicators[0].direction).toBe('supports_reliability');
  });

  it('labels every signal as a heuristic with an excerpt for pattern matches', () => {
    const [first] = detectLanguageSignals('This shocking discovery changes everything.');
    expect(first.origin).toBe('heuristic');
    expect(first.excerpt).toContain('shocking');
  });
});

describe('languageConcernIntensity', () => {
  it('is 0 with no signals and grows with more signals but stays below 1', () => {
    expect(languageConcernIntensity([])).toBe(0);
    const one = languageConcernIntensity(detectLanguageSignals('Shocking news today for all.'));
    const many = languageConcernIntensity(
      detectLanguageSignals(
        "SHOCKING!!! Experts confirm it completely cures cancer. Share now before it's deleted",
      ),
    );
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThan(1);
  });
});
