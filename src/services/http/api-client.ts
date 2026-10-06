import type { ApiErrorBody, ApiErrorCode } from '@/core/api-contract';
import { ServiceRequestError } from '@/core/errors';

export interface PostJsonOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

async function readApiError(
  response: Response,
): Promise<{ code?: ApiErrorCode; message?: string }> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    return { code: body.error?.code, message: body.error?.message };
  } catch {
    return {};
  }
}

/** POSTs JSON and maps every failure mode to a typed {@link ServiceRequestError}. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  { timeoutMs, fetchImpl = fetch }: PostJsonOptions,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ServiceRequestError('Request timed out', 'timeout');
    }
    throw new ServiceRequestError(
      error instanceof Error ? error.message : 'Network request failed',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const apiError = await readApiError(response);
    throw new ServiceRequestError(
      apiError.message ?? `HTTP ${response.status}`,
      'http',
      response.status,
      apiError.code,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ServiceRequestError('Response was not valid JSON', 'invalid_response');
  }
}
