import { ValidationError } from './errors';
import { type SupportedImageType, checkImagePayload } from './image/image-payload';

export const TEXT_LIMITS = { min: 12, max: 5000 } as const;
export const CLAIM_LIMITS = { min: 8, max: 500 } as const;
export function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countWords(input: string): number {
  return input.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Validates and normalizes free text or a claim. Throws {@link ValidationError}. */
export function validateTextInput(raw: string, mode: 'text' | 'claim'): string {
  const limits = mode === 'claim' ? CLAIM_LIMITS : TEXT_LIMITS;
  const text = normalizeWhitespace(raw ?? '');
  const noun = mode === 'claim' ? 'claim' : 'text';

  if (text.length === 0) {
    throw new ValidationError(`Enter some ${noun} to analyze.`);
  }
  if (text.length < limits.min || countWords(text) < 3) {
    throw new ValidationError(`The ${noun} is too short to analyze. Add a complete statement.`);
  }
  if (text.length > limits.max) {
    throw new ValidationError(
      `The ${noun} is too long (${text.length} characters). The limit is ${limits.max}.`,
    );
  }
  return text;
}

export interface ImageInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width?: number;
  height?: number;
  /** Base64 image data (or a base64 data URI on web); required to analyze the image. */
  base64?: string | null;
}

export interface ValidatedImage extends ImageInput {
  /** Base64 without any data-URI prefix. */
  base64: string;
  /** Detected from the bytes, not from metadata. */
  mediaType: SupportedImageType;
  bytes: number;
}

/**
 * Validates an image before upload: present, a supported format detected from its
 * bytes, within the size limit, and not damaged. Throws {@link ValidationError}.
 * The server repeats these checks independently.
 */
export function validateImageInput(image: ImageInput | null | undefined): ValidatedImage {
  if (!image?.uri) {
    throw new ValidationError('Select an image to analyze.');
  }
  const data = image.base64 ?? (image.uri.startsWith('data:') ? image.uri : null);
  if (!data) {
    throw new ValidationError('The image data could not be read. Try selecting the image again.');
  }
  const check = checkImagePayload({
    base64: data,
    declaredType: image.mimeType,
    fileName: image.fileName,
  });
  if (!check.ok) throw new ValidationError(check.message);
  return { ...image, base64: check.base64, mediaType: check.mediaType, bytes: check.bytes };
}
