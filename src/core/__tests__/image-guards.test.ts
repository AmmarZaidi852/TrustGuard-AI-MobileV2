import {
  mockImageReading,
  mockImageReadingMultiple,
  mockImageReadingOpinion,
  mockImageReadingUnreadable,
} from '@/test/fixtures';

import {
  MAX_IMAGE_CLAIMS,
  guardImageAnalysis,
  isGrounded,
  primaryImageClaim,
} from '../image/image-guards';
import type { ImageClaim } from '../types';

const claim = (patch: Partial<ImageClaim> = {}): ImageClaim => ({
  ...mockImageReading.claims[0],
  ...patch,
});

describe('guardImageAnalysis', () => {
  it('accepts a readable factual claim grounded in the visible text', () => {
    const result = guardImageAnalysis(mockImageReading);
    expect(result.claims[0]).toMatchObject({ grounded: true, checkable: true });
    expect(primaryImageClaim(result)?.text).toBe('Drinking coffee completely prevents cancer.');
  });

  it('does not let the model invent text: ungrounded claims are not checkable', () => {
    const result = guardImageAnalysis({
      ...mockImageReading,
      claims: [claim({ quote: 'NASA confirmed aliens built the pyramids' })],
    });
    expect(result.claims[0]).toMatchObject({ grounded: false, checkable: false });
    expect(result.primaryClaimIndex).toBeNull();
  });

  it('checks nothing when the text is unreadable, even if the model lists a claim', () => {
    const result = guardImageAnalysis({
      ...mockImageReadingUnreadable,
      visibleText: mockImageReading.visibleText,
      claims: mockImageReading.claims,
      primaryClaimIndex: 0,
    });
    expect(result.claims[0].checkable).toBe(false);
    expect(result.primaryClaimIndex).toBeNull();
  });

  it('marks claims quoting [illegible] text as partly readable', () => {
    const result = guardImageAnalysis({
      ...mockImageReading,
      readability: 'partial',
      visibleText:
        'Scientists have confirmed that drinking [illegible] completely prevents cancer.',
      claims: [claim({ quote: 'drinking [illegible] completely prevents cancer' })],
    });
    expect(result.claims[0].readability).toBe('partial');
  });

  it('never treats opinions, jokes or predictions as checkable', () => {
    expect(guardImageAnalysis(mockImageReadingOpinion).primaryClaimIndex).toBeNull();
    const prediction = guardImageAnalysis({
      ...mockImageReading,
      claims: [claim({ claimType: 'prediction' })],
    });
    expect(prediction.claims[0].checkable).toBe(false);
    const joke = guardImageAnalysis({ ...mockImageReading, claims: [claim({ isFactual: false })] });
    expect(joke.claims[0].checkable).toBe(false);
  });

  it(`keeps at most ${MAX_IMAGE_CLAIMS} separate claims`, () => {
    const many = Array.from({ length: 6 }, () => claim());
    expect(guardImageAnalysis({ ...mockImageReading, claims: many }).claims).toHaveLength(
      MAX_IMAGE_CLAIMS,
    );
  });

  it('keeps multiple claims separate and falls back to the first checkable primary', () => {
    const result = guardImageAnalysis({ ...mockImageReadingMultiple, primaryClaimIndex: 7 });
    expect(result.claims).toHaveLength(2);
    expect(result.claims.every((c) => c.checkable)).toBe(true);
    expect(result.primaryClaimIndex).toBe(0);
  });

  it('rejects a non-checkable primary chosen by the model', () => {
    const result = guardImageAnalysis({
      ...mockImageReadingMultiple,
      claims: [claim({ isFactual: false }), mockImageReadingMultiple.claims[1]],
      primaryClaimIndex: 0,
    });
    expect(result.primaryClaimIndex).toBe(1);
  });

  it('requires complete statements', () => {
    const result = guardImageAnalysis({
      ...mockImageReading,
      claims: [claim({ text: 'Coffee cures' })],
    });
    expect(result.claims[0].checkable).toBe(false);
  });
});

test('isGrounded ignores case, quotes and punctuation but needs real overlap', () => {
  expect(isGrounded('“Coffee PREVENTS cancer!”', 'Fact: coffee prevents cancer.')).toBe(true);
  expect(isGrounded('Coffee prevents cancer', 'Tea prevents colds')).toBe(false);
  expect(isGrounded('abc', 'abc def')).toBe(false);
});
