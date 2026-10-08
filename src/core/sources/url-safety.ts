/**
 * Validation for source URLs before they are returned to, or opened by, the app.
 * Implemented without `URL` so it behaves identically on the server, in Hermes
 * on iOS and in tests.
 */

const MAX_URL_LENGTH = 2048;
const AUTHORITY = /^(https?):\/\/([^/?#\s]+)([/?#][^\s]*)?$/i;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'local', 'internal']);

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || /^\d+$/.test(host);
}

/**
 * Returns the URL if it is a safe, public http(s) web address, otherwise `null`.
 * Rejects other schemes (javascript:, data:, file:), embedded credentials, IP
 * literals, localhost/internal names, odd ports and malformed hosts.
 */
export function validateSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  // Control characters and spaces are never valid in a URL we will open.
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return null;

  const match = AUTHORITY.exec(url);
  if (!match) return null;
  const authority = match[2];
  if (authority.includes('@') || authority.includes('\\')) return null;

  const [host, port, ...rest] = authority.toLowerCase().split(':');
  if (rest.length > 0) return null;
  if (port !== undefined && !/^(80|443)$/.test(port)) return null;
  if (isIpLiteral(host)) return null;

  const hostname = host.replace(/\.$/, '');
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    return null;
  }
  const labels = hostname.split('.');
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return null;
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/i.test(labels[labels.length - 1])) return null;

  return url;
}

export function isSafeSourceUrl(raw: unknown): raw is string {
  return validateSourceUrl(raw) !== null;
}
