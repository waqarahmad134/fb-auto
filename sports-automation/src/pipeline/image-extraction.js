// Pure HTML parsing logic, isolated so it can be unit-tested without a real HTTP fetch.

/**
 * Extract the og:image (or twitter:image as a fallback) URL from an HTML document.
 * Handles both attribute orders (property/content or content/property) and both quote styles.
 * @param {string} html
 * @returns {string|null}
 */
export function extractOgImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
