import { ValidationError } from '../errors';
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
  it('rejects unsupported types and oversized files', () => {
    expect(() => validateImageInput({ uri: 'file://a.gif', mimeType: 'image/gif' })).toThrow(
      'not supported',
    );
    expect(() => validateImageInput({ uri: 'file://a.jpg', fileSize: 11 * 1024 * 1024 })).toThrow(
      '10 MB',
    );
  });
  it('accepts a normal image', () => {
    const image = { uri: 'file://a.png', mimeType: 'image/png', fileSize: 2000 };
    expect(validateImageInput(image)).toBe(image);
  });
});

test('normalizeWhitespace collapses spaces', () => {
  expect(normalizeWhitespace('a \t b')).toBe('a b');
});
