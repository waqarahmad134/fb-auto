/** Greedily wrap text into lines of at most maxCharsPerLine, breaking on word boundaries. */
export function wrapText(text, maxCharsPerLine) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines.join("\n");
}

/**
 * Cap already-wrapped multi-line text to at most maxLines, appending an ellipsis to
 * the last kept line if anything was cut — so a headline never grows into a tall
 * block that covers too much of the image.
 */
export function truncateToMaxLines(wrappedText, maxLines) {
  const lines = wrappedText.split("\n");
  if (lines.length <= maxLines) return wrappedText;

  const kept = lines.slice(0, maxLines);
  kept[kept.length - 1] = `${kept[kept.length - 1].replace(/[.,;:!?]+$/, "")}…`;
  return kept.join("\n");
}
