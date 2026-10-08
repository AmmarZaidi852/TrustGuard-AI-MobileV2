import { validateSourceUrl } from '../sources/url-safety';

describe('validateSourceUrl', () => {
  it.each([
    'https://www.who.int/news-room/fact-sheets/detail/cancer',
    'http://example.org/path?q=1#section',
    'https://www.bbc.co.uk/news/health-123',
    'https://sub.domain.example.com:443/a',
    'https://xn--bcher-kva.example/',
  ])('accepts public web URL %s', (url) => {
    expect(validateSourceUrl(url)).toBe(url);
  });

  it.each([
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://example.com/file'],
    ['protocol-relative', '//example.com/a'],
    ['no scheme', 'example.com/a'],
    ['embedded credentials', 'https://user:pass@example.com/'],
    ['credential spoofing', 'https://www.who.int@evil.example/'],
    ['localhost', 'http://localhost:3000/admin'],
    ['localhost subdomain', 'https://api.localhost/'],
    ['.local host', 'https://printer.local/'],
    ['IPv4 literal', 'http://169.254.169.254/latest/meta-data'],
    ['private IPv4', 'http://192.168.1.1/'],
    ['IPv6 literal', 'http://[::1]/'],
    ['decimal IP', 'http://2130706433/'],
    ['odd port', 'https://example.com:8080/'],
    ['single-label host', 'https://intranet/'],
    ['whitespace', 'https://example.com/a b'],
    ['control character', 'https://example.com/\u0000'],
    ['backslash trick', 'https://example.com\\@evil.com/'],
    ['bad label', 'https://-bad-.example.com/'],
    ['numeric TLD', 'https://example.123/'],
    ['too long', `https://example.com/${'a'.repeat(2100)}`],
    ['empty', ''],
    ['not a string', 42],
  ])('rejects %s', (_name, url) => {
    expect(validateSourceUrl(url)).toBeNull();
  });
});
