// Pure content-validation logic, isolated from 02-generateContent.js so it can be
// unit-tested without pulling in config.js (which exits the process on missing env vars).
import logger from "../utils/logger.js";

export const GENERIC_IMAGE_PROMPT =
  "a footballer in a plain kit celebrating a goal under stadium floodlights at night, cinematic lighting, vertical composition, no visible face detail, no team crests or logos";

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
  return null;
}

/** Heuristic: capitalized word pairs in the title (simple person-name detector). */
export function extractNameCandidates(title) {
  const matches = title.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g) || [];
  return [...new Set(matches)];
}

export function personNamePostCheck(title, imagePrompt) {
  const candidates = extractNameCandidates(title);
  const hit = candidates.find((name) => imagePrompt.includes(name));
  if (hit) {
    logger.warn({ hit }, "imagePrompt referenced a likely person name — replacing with generic template");
    return GENERIC_IMAGE_PROMPT;
  }
  return imagePrompt;
}
