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
 * Off Cloudflare, `CF-Connecting-IP` is caller-supplied too, so the key is only as
 * trustworthy as the proxy in front. Values that are not IP-shaped are ignored, so
 * a caller cannot fill the limiter with long or arbitrary keys.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0];
  return ipShaped(request.headers.get('cf-connecting-ip')) ?? ipShaped(forwarded) ?? 'unknown';
}

/** IPv4 or IPv6 characters only, at most 45 long (the longest IPv6 text form). */
function ipShaped(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[0-9a-f:.]{2,45}$/.test(trimmed) ? trimmed : null;
}
