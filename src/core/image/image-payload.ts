/**
 * Image payload validation shared by the app (before upload) and the server
 * (authoritative). The format is detected from the bytes themselves; the
 * client-declared MIME type and file name are never trusted on their own.
 *
 * Formats: the ones Claude's vision API accepts and iOS/web pickers produce.
 * HEIC is not accepted by the API; the iOS picker's base64 output is JPEG, so
 * HEIC photos are converted before they reach this check.
 */

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export const IMAGE_LIMITS = {
  /** Decoded bytes. Matches the Claude API's per-image limit. */
  maxBytes: 5 * 1024 * 1024,
  /** Smallest plausible real image; anything smaller is treated as invalid. */
  minBytes: 64,
} as const;

/** Extensions of image files a picker may report (some are transcoded before upload). */
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
]);

export type ImagePayloadErrorCode =
  'empty_image' | 'unsupported_image' | 'image_too_large' | 'invalid_image';

export type ImagePayloadCheck =
  | { ok: true; base64: string; mediaType: SupportedImageType; bytes: number }
  | { ok: false; code: ImagePayloadErrorCode; message: string };

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes only the first bytes of a base64 string (enough for format signatures). */
export function decodeBase64Prefix(base64: string, maxBytes = 16): number[] {
  const bytes: number[] = [];
  const chars = base64.slice(0, Math.ceil((maxBytes * 4) / 3) + 4);
  for (let i = 0; i + 3 < chars.length && bytes.length < maxBytes; i += 4) {
    const values = [0, 1, 2, 3].map((j) => BASE64_ALPHABET.indexOf(chars[i + j]));
    if (values[0] < 0 || values[1] < 0) break;
    bytes.push((values[0] << 2) | (values[1] >> 4));
    if (values[2] >= 0) bytes.push(((values[1] & 15) << 4) | (values[2] >> 2));
    if (values[3] >= 0) bytes.push(((values[2] & 3) << 6) | values[3]);
  }
  return bytes.slice(0, maxBytes);
}

export function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const startsWith = (bytes: number[], signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** Identifies the image format from its magic bytes, or `null` if unsupported/unknown. */
export function sniffImageType(base64: string): SupportedImageType | null {
  const bytes = decodeBase64Prefix(base64, 16);
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** Recognisable but unsupported formats, for a more helpful message. */
function describeUnsupported(base64: string): string | null {
  const bytes = decodeBase64Prefix(base64, 16);
  if (startsWith(bytes, ascii('ftyp'), 4)) return 'HEIC/HEIF photos';
  if (startsWith(bytes, ascii('%PDF'))) return 'PDF files';
  if (startsWith(bytes, ascii('BM'))) return 'BMP images';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'TIFF images';
  }
  if (startsWith(bytes, ascii('<'))) return 'SVG or HTML files';
  return null;
}

/** Accepts a raw base64 string or a `data:image/...;base64,` URI (web pickers). */
export function stripDataUri(input: string): { base64: string; declaredType: string | null } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i.exec(input);
  return match
    ? { base64: input.slice(match[0].length), declaredType: match[1]?.toLowerCase() ?? null }
    : { base64: input, declaredType: null };
}

function extensionOf(fileName: string | null | undefined): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName ?? '');
  return match ? match[1].toLowerCase() : null;
}

const SUPPORTED_LABEL = 'JPEG, PNG, WebP or GIF';

export function checkImagePayload(input: {
  base64: string | null | undefined;
  declaredType?: string | null;
  fileName?: string | null;
}): ImagePayloadCheck {
  const raw = (input.base64 ?? '').trim();
  if (!raw) {
    return { ok: false, code: 'empty_image', message: 'The image is empty. Choose another image.' };
  }
  const stripped = stripDataUri(raw);
  const base64 = stripped.base64.replace(/\s+/g, '');

  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return {
      ok: false,
      code: 'invalid_image',
      message: 'The image data is damaged or incomplete. Choose the image again.',
    };
  }

  const bytes = decodedByteLength(base64);
  if (bytes > IMAGE_LIMITS.maxBytes) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      code: 'image_too_large',
      message: `The image is too large (${mb} MB). The limit is 5 MB — try a screenshot or crop the image.`,
    };
  }
  if (bytes < IMAGE_LIMITS.minBytes) {
    return { ok: false, code: 'invalid_image', message: 'The image data is not a valid image.' };
  }

  const mediaType = sniffImageType(base64);
  if (!mediaType) {
    const known = describeUnsupported(base64);
    return {
      ok: false,
      code: 'unsupported_image',
      message: known
        ? `${known} are not supported. Use a ${SUPPORTED_LABEL} image (a screenshot works well).`
        : `This file is not a supported image. Use a ${SUPPORTED_LABEL} image.`,
    };
  }

  // Pickers legitimately transcode (e.g. iOS HEIC → JPEG), so image-to-image
  // differences are expected. Metadata that claims a non-image file is not.
  const declared = (input.declaredType ?? stripped.declaredType)?.toLowerCase() ?? null;
  const extension = extensionOf(input.fileName);
  if (
    (declared && !declared.startsWith('image/')) ||
    (extension && !IMAGE_EXTENSIONS.has(extension))
  ) {
    return {
      ok: false,
      code: 'invalid_image',
      message: 'This file is not an image. Choose a JPEG, PNG, WebP or GIF image.',
    };
  }

  return { ok: true, base64, mediaType, bytes };
}
