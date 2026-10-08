import { ValidationError } from '../errors';
import { IMAGE_BYTES } from '@/test/fixtures';

import { normalizeWhitespace, validateImageInput, validateTextInput } from '../validation';

describe('validateTextInput', () => {
  it('normalizes and returns valid text', () => {
    expect(validateTextInput('  NASA   discovered life\r\n\r\n\r\non Mars.  ', 'claim')).toBe(
      'NASA discovered life\n\non Mars.',
    );
  });

  it.each([
    ['', 'Enter some'],
    ['   ', 'Enter some'],
    ['hi', 'too short'],
    ['!!!! ???? ....', 'too short'],
  ])('rejects %j', (input, message) => {
    expect(() => validateTextInput(input, 'text')).toThrow(ValidationError);
    expect(() => validateTextInput(input, 'text')).toThrow(message);
  });

  it('enforces separate length limits for claims and text', () => {
    const long = 'word '.repeat(150);
    expect(() => validateTextInput(long, 'claim')).toThrow('too long');
    expect(validateTextInput(long, 'text')).toHaveLength(long.trim().length);
  });
});

describe('validateImageInput', () => {
  it('requires an image', () => {
    expect(() => validateImageInput(null)).toThrow('Select an image');
  });
  it('rejects unsupported types (by content) and oversized images', () => {
    expect(() =>
      validateImageInput({ uri: 'file://a.pdf', mimeType: 'image/png', base64: IMAGE_BYTES.pdf }),
    ).toThrow('not supported');
    const big = 'A'.repeat(Math.ceil(((6 * 1024 * 1024) / 3) * 4));
    expect(() =>
      validateImageInput({ uri: 'file://a.jpg', base64: IMAGE_BYTES.jpeg.slice(0, 8) + big }),
    ).toThrow('5 MB');
  });
  it('accepts a normal image and reports the type detected from its bytes', () => {
    const image = {
      uri: 'file://a.png',
      mimeType: 'image/png',
      fileSize: 2000,
      base64: IMAGE_BYTES.png,
    };
    expect(validateImageInput(image)).toMatchObject({ ...image, mediaType: 'image/png' });
  });
});

test('normalizeWhitespace collapses spaces', () => {
  expect(normalizeWhitespace('a \t b')).toBe('a b');
});
