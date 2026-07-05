// Pure content-validation logic, isolated from 02-generateContent.js so it can be
// unit-tested without pulling in config.js (which exits the process on missing env vars).
import logger from "../utils/logger.js";

// Framed as a backlit silhouette rather than relying on negative instructions
// ("no face", "no logo") — free image models follow compositional/lighting cues
// (backlit, silhouette, blurred) far more reliably than negative prompts, which
// they frequently ignore.
export const GENERIC_IMAGE_PROMPT =
  "a silhouette of a footballer celebrating with arms raised, strongly backlit against bright stadium floodlights at night, jersey and facial features lost in shadow, blurred out-of-focus background, cinematic silhouette photography, vertical composition";

export function wordCount(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

export function validateContent(obj) {
  if (!obj || typeof obj !== "object") return "not an object";
  if (typeof obj.script !== "string" || !obj.script.trim()) return "missing script";
  const wc = wordCount(obj.script);
  if (wc < 60 || wc > 140) return `script word count ${wc} out of range 60-140`;
  if (typeof obj.imagePrompt !== "string" || !obj.imagePrompt.trim()) return "missing imagePrompt";
  if (typeof obj.title !== "string" || !obj.title.trim() || obj.title.length > 100) return "invalid title";
  if (typeof obj.description !== "string" || !obj.description.trim()) return "missing description";
  if (!Array.isArray(obj.hashtags) || obj.hashtags.length === 0) return "missing hashtags";
  if (typeof obj.posterHeadline !== "string" || !obj.posterHeadline.trim() || obj.posterHeadline.length > 70) {
    return "invalid posterHeadline";
  }
  if (typeof obj.posterSubtext !== "string") return "missing posterSubtext";
  return null;
}

/** Heuristic: capitalized word pairs (simple full-name detector). */
export function extractNameCandidates(text) {
  const matches = text.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g) || [];
  return [...new Set(matches)];
}

// Generic vocabulary and common national teams/countries the LLM legitimately uses
// in imagePrompt (flags, kits) — excluded so single capitalized words like "Norway"
// don't get flagged as a person's name. Deliberately not exhaustive: any false
// negative here just means an occasional real name slips through to the retry/
// fallback safety net further up the call chain; any false positive just means an
// extra swap to the safe generic image, which is always harmless.
const IMAGE_PROMPT_SAFE_WORDS = new Set([
  "Football", "Soccer", "Sports", "Shorts", "Premier", "League", "Cup", "Euro", "World",
  "Champions", "Cinematic", "Vertical", "Horizontal", "High", "Contrast", "Backlighting",
  "Backlit", "Silhouette", "Silhouetted", "Stadium", "Floodlights", "Floodlit", "Night",
  "Framing", "Composition", "Lighting", "Blurred", "Close", "Wide", "Shot", "Photography",
  "England", "Brazil", "Norway", "France", "Spain", "Germany", "Italy", "Portugal",
  "Argentina", "Netherlands", "Belgium", "Croatia", "Wales", "Scotland", "Ireland",
  "Mexico", "Japan", "Qatar", "Morocco", "Senegal", "Ghana", "Nigeria", "Egypt",
  "Australia", "Canada", "America"
]);

/**
 * Single capitalized words in imagePrompt that aren't sentence-initial and aren't a
 * known generic/place term — likely a real person's name the model wrote in on its
 * own, independent of anything in the source article (surname-only mentions like
 * "Ronaldo" or "Ancelotti" don't form a two-word pair, so extractNameCandidates
 * alone won't catch them).
 */
export function findPersonLikeWords(imagePrompt) {
  const words = imagePrompt.split(/\s+/);
  const hits = [];
  words.forEach((raw, i) => {
    if (i === 0) return; // sentence-initial capital isn't a name signal
    const word = raw.replace(/[^A-Za-z]/g, "");
    if (word.length < 3 || !/^[A-Z][a-z]+$/.test(word)) return;
    if (IMAGE_PROMPT_SAFE_WORDS.has(word)) return;
    hits.push(word);
  });
  return hits;
}

export function personNamePostCheck(title, imagePrompt) {
  const titleNames = extractNameCandidates(title);
  const hit = titleNames.find((name) => imagePrompt.includes(name)) || findPersonLikeWords(imagePrompt)[0];
  if (hit) {
    logger.warn({ hit }, "imagePrompt referenced a likely person name — replacing with generic template");
    return GENERIC_IMAGE_PROMPT;
  }
  return imagePrompt;
}
