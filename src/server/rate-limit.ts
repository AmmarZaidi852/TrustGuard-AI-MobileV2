/**
 * Best-effort, in-memory fixed-window rate limiter. It protects the API key from
 * accidental loops or casual abuse on a single server instance; it is not a
 * substitute for provider-side spend limits.
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const windows = new Map<string, { start: number; count: number }>();

  return function allow(key: string): boolean {
    const time = now();
    const current = windows.get(key);
    if (!current || time - current.start >= windowMs) {
      windows.set(key, { start: time, count: 1 });
      if (windows.size > 10_000) windows.clear();
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}

/**
 * The client's address as the platform reports it. EAS Hosting runs on Cloudflare,
 * which sets `CF-Connecting-IP` itself, so it is preferred. `X-Forwarded-For` is a
 * fallback for local servers: its first entry is whatever the caller sent, so
 * trusting it first would let a caller dodge the limit by changing the header.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip')?.trim() || forwarded || 'unknown';
}
