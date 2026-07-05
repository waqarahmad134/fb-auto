// Pure logic for detecting a flat-color letterbox/border band (e.g. a social-share
// card template's baked-in black bars) isolated from image decoding for testability.

/**
 * True if most of a set of [r,g,b] pixel samples closely match one dominant color —
 * the signature of a baked-in letterbox/pillarbox bar (as opposed to a real photo,
 * which always has texture/gradient even in dark regions like a night sky). Uses a
 * majority-match rather than requiring the whole strip to be flat, since the real
 * photo content behind a border often pokes slightly into the sampled strip.
 */
export function isUniformColorBand(pixels, { colorTolerance = 12, uniformFraction = 0.85 } = {}) {
  if (!pixels || pixels.length === 0) return false;

  const avg = [0, 1, 2].map((c) => pixels.reduce((sum, p) => sum + p[c], 0) / pixels.length);
  const matchCount = pixels.filter((p) =>
    [0, 1, 2].every((c) => Math.abs(p[c] - avg[c]) <= colorTolerance)
  ).length;

  return matchCount / pixels.length >= uniformFraction;
}
