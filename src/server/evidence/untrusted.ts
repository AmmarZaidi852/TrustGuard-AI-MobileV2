/**
 * Untrusted text (user claims, search results, page excerpts) is placed inside
 * XML-style tags in prompts. Escaping angle brackets stops that text from closing
 * its tag or opening fake ones (e.g. `</source><instructions>`).
 */
export function escapeUntrusted(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function clipText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
