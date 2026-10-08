import { IMAGE_BYTES, bytesToBase64 } from '@/test/fixtures';

import {
  IMAGE_LIMITS,
  checkImagePayload,
  decodedByteLength,
  sniffImageType,
  stripDataUri,
} from '../image/image-payload';

describe('sniffImageType', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
  ] as const)('detects %s from its bytes', (format, type) => {
    expect(sniffImageType(IMAGE_BYTES[format])).toBe(type);
  });

  it.each(['heic', 'pdf'] as const)('does not accept %s', (format) => {
    expect(sniffImageType(IMAGE_BYTES[format])).toBeNull();
  });
});

describe('checkImagePayload', () => {
  it.each(['png', 'jpeg', 'gif', 'webp'] as const)('accepts a valid %s image', (format) => {
    const result = checkImagePayload({ base64: IMAGE_BYTES[format] });
    expect(result).toMatchObject({ ok: true });
  });

  it('accepts a base64 data URI (web picker) and strips the prefix', () => {
    const result = checkImagePayload({ base64: `data:image/png;base64,${IMAGE_BYTES.png}` });
    expect(result).toEqual({
      ok: true,
      base64: IMAGE_BYTES.png,
      mediaType: 'image/png',
      bytes: decodedByteLength(IMAGE_BYTES.png),
    });
  });

  it('uses the bytes, not the declared type: a PDF labelled as PNG is rejected', () => {
    const result = checkImagePayload({ base64: IMAGE_BYTES.pdf, declaredType: 'image/png' });
    expect(result).toMatchObject({ ok: false, code: 'unsupported_image' });
    if (!result.ok) expect(result.message).toMatch(/PDF files are not supported/);
  });

  it('explains that HEIC is not supported', () => {
    const result = checkImagePayload({ base64: IMAGE_BYTES.heic });
    expect(result).toMatchObject({ ok: false, code: 'unsupported_image' });
    if (!result.ok) expect(result.message).toMatch(/HEIC/);
  });

  it('accepts JPEG bytes with HEIC metadata (iOS picker transcoding)', () => {
    expect(
      checkImagePayload({
        base64: IMAGE_BYTES.jpeg,
        declaredType: 'image/heic',
        fileName: 'IMG_0001.HEIC',
      }),
    ).toMatchObject({ ok: true, mediaType: 'image/jpeg' });
  });

  it.each([
    ['a non-image MIME type', { declaredType: 'text/html' }],
    ['a non-image extension', { fileName: 'payload.exe' }],
  ])('rejects image bytes with %s', (_name, meta) => {
    expect(checkImagePayload({ base64: IMAGE_BYTES.png, ...meta })).toMatchObject({
      ok: false,
      code: 'invalid_image',
    });
  });

  it('rejects images over 5 MB', () => {
    // 7,000,008 base64 chars (a multiple of 4) ≈ 5.25 MB decoded.
    const big = IMAGE_BYTES.jpeg.slice(0, 8) + 'A'.repeat(7_000_000);
    expect(decodedByteLength(big)).toBeGreaterThan(IMAGE_LIMITS.maxBytes);
    const result = checkImagePayload({ base64: big });
    expect(result).toMatchObject({ ok: false, code: 'image_too_large' });
  });

  it.each([
    ['empty', '', 'empty_image'],
    ['whitespace', '   ', 'empty_image'],
    ['invalid characters', `${IMAGE_BYTES.png.slice(0, 40)}!!!!`, 'invalid_image'],
    ['truncated base64', IMAGE_BYTES.png.slice(0, 41), 'invalid_image'],
    ['too small to be an image', bytesToBase64([0x89, 0x50, 0x4e, 0x47], 8), 'invalid_image'],
    ['random bytes', bytesToBase64([1, 2, 3, 4, 5]), 'unsupported_image'],
  ])('rejects %s data', (_name, base64, code) => {
    expect(checkImagePayload({ base64 })).toMatchObject({ ok: false, code });
  });

  it('rejects null data', () => {
    expect(checkImagePayload({ base64: null })).toMatchObject({ ok: false, code: 'empty_image' });
  });
});

test('stripDataUri leaves plain base64 untouched', () => {
  expect(stripDataUri('abcd')).toEqual({ base64: 'abcd', declaredType: null });
});
