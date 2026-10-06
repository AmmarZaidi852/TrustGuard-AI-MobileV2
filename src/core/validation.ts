import { ValidationError } from './errors';

export const TEXT_LIMITS = { min: 12, max: 5000 } as const;
export const CLAIM_LIMITS = { min: 8, max: 500 } as const;
export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
} as const;

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
  fileSize?: number | null;
  width?: number;
  height?: number;
  /** Base64 image data, required to send the image to the analysis backend. */
  base64?: string | null;
}

export function validateImageInput(image: ImageInput | null | undefined): ImageInput {
  if (!image?.uri) {
    throw new ValidationError('Select an image to analyze.');
  }
  const mime = image.mimeType?.toLowerCase();
  if (mime && !(IMAGE_LIMITS.mimeTypes as readonly string[]).includes(mime)) {
    throw new ValidationError(
      'This file type is not supported. Use a JPEG, PNG, WebP or HEIC image.',
    );
  }
  if (image.fileSize && image.fileSize > IMAGE_LIMITS.maxBytes) {
    throw new ValidationError('The image is larger than 10 MB. Choose a smaller image.');
  }
  return image;
}
