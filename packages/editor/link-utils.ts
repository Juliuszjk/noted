const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

// Turns what the user typed into a safe href, or null if it is not acceptable.
// "example.com" becomes https://example.com, "a@b.c" becomes mailto:a@b.c, and anything that
// could run code (javascript:, data:, ...) is rejected.
export const normalizeLinkUrl = (input: string): string | null => {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;

  // "localhost:3000" and "example.com:8080" look like a scheme but are host:port.
  const hostWithPort = /^[^\s/:@]+:\d+(?:[/?#].*)?$/.test(value);
  const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(value);

  let candidate = value;
  if (!hasScheme) {
    candidate = /^[^\s/@]+@[^\s/@]+$/.test(value) ? `mailto:${value}` : `https://${value}`;
  }

  try {
    return SAFE_PROTOCOLS.includes(new URL(candidate).protocol) ? candidate : null;
  } catch {
    return null;
  }
};
