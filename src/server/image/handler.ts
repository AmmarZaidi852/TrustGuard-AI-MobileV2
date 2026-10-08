import type { ImageAnalysisRequest } from '@/core/api-contract';
import { IMAGE_LIMITS, checkImagePayload } from '@/core/image/image-payload';

import { ApiError, errorResponse } from '../api-error';
import { clientKey } from '../rate-limit';
import type { VisionAnalyzerFn } from './vision-analyzer';

/** Base64 inflates by 4/3; allow JSON overhead on top. */
export const MAX_IMAGE_REQUEST_BYTES = Math.ceil((IMAGE_LIMITS.maxBytes * 4) / 3) + 64 * 1024;

export interface ImageHandlerDeps {
  /** `null` when the server has no provider credentials configured. */
  analyzer: VisionAnalyzerFn | null;
  allowRequest: (key: string) => boolean;
  /** Receives short messages only. Image bytes are never passed to it. */
  log?: (message: string) => void;
}

/**
 * POST /api/v1/images/analyze — validates the image (independently of the app),
 * sends it to Claude vision, and returns the structured, guarded reading. The
 * image is held in memory for this request only: it is not written to disk,
 * stored, or logged.
 */
export function createImageHandler({
  analyzer,
  allowRequest,
  log = (message) => console.error(message),
}: ImageHandlerDeps) {
  return async function handle(request: Request): Promise<Response> {
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_IMAGE_REQUEST_BYTES) {
      return errorResponse('image_too_large', 'The image is too large. The limit is 5 MB.');
    }

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return errorResponse('invalid_request', 'The upload could not be read. Please try again.');
    }
    if (raw.length > MAX_IMAGE_REQUEST_BYTES) {
      return errorResponse('image_too_large', 'The image is too large. The limit is 5 MB.');
    }

    let body: Partial<ImageAnalysisRequest>;
    try {
      body = JSON.parse(raw) ?? {};
    } catch {
      return errorResponse('invalid_request', 'The request body must be JSON.');
    }
    if (typeof body !== 'object' || typeof body.image !== 'string') {
      return errorResponse('empty_image', 'No image was received.');
    }

    // Authoritative validation: format from the bytes, size, base64 integrity.
    const check = checkImagePayload({ base64: body.image });
    if (!check.ok) return errorResponse(check.code, check.message);
    // The app sends the type it detected; disagreement means the payload was tampered with.
    if (body.mediaType !== check.mediaType) {
      return errorResponse('invalid_image', 'The image type does not match its contents.');
    }

    if (!analyzer) {
      return errorResponse(
        'not_configured',
        'Image analysis is not configured on the server (missing ANTHROPIC_API_KEY).',
      );
    }
    if (!allowRequest(clientKey(request))) {
      return errorResponse(
        'rate_limited',
        'Too many image analyses in a short time. Wait a few minutes and try again.',
      );
    }

    try {
      return Response.json(await analyzer({ image: check.base64, mediaType: check.mediaType }));
    } catch (error) {
      if (error instanceof ApiError) {
        log(`[image] ${error.code}: ${error.message} (${check.mediaType}, ${check.bytes} bytes)`);
        return errorResponse(error.code, error.message);
      }
      log(`[image] unexpected error (${check.mediaType}, ${check.bytes} bytes)`);
      return errorResponse('internal', 'Unexpected error while analyzing the image.');
    }
  };
}
