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

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('cf-connecting-ip') || 'unknown';
}
