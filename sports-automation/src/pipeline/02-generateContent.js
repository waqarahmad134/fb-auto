import fs from "node:fs/promises";
import path from "node:path";
import config from "../config.js";
import logger from "../utils/logger.js";
import { timeoutSignal, throwIfCancelled } from "../utils/cancellation.js";
import { GENERIC_IMAGE_PROMPT, wordCount, validateContent, personNamePostCheck } from "./content-validation.js";

export { GENERIC_IMAGE_PROMPT, validateContent, personNamePostCheck } from "./content-validation.js";

const SYSTEM_PROMPT = `You are a professional sports graphic designer, fact-checker, and content editor producing one short vertical video for a football news Shorts channel, based only on the headline/snippet/source given to you.

Ground rules:
- Treat the given title/snippet/source as your only verified facts. Do not invent scores, transfers, quotes, or outcomes that aren't in them, and do NOT bring in any player, manager, club, or team that isn't explicitly named in the title/snippet — even a real, famous name is a fabrication if it isn't actually in the source for this story. If the snippet is empty or thin, stick tightly to only what the title says rather than inventing supporting detail to fill space.
- If the snippet is thin, a preview, or clearly a developing story (no final result stated), say so plainly instead of guessing.
- Never describe or reference any real broadcaster's logo, watermark, branding, or layout. Everything you describe must be an original composition, inspired by the topic, not copied from any real graphic.
- Never name or describe any real, identifiable person's face or a real team crest/logo in the image description — not even a person who is genuinely named in the source.

Produce a JSON object with:
- "script": a 90-110 word voiceover script, conversational spoken tone, grammatically correct, no headlines, do NOT start with phrases like "In a recent article" or "According to", hook the viewer in the first sentence.
- "imagePrompt": an original, premium-quality sports-graphic background scene — bright, modern, cinematic, high-contrast — framed as a backlit silhouette so faces, jersey branding, and crests naturally stay hidden in shadow (image models follow lighting/composition cues far more reliably than "no face"/"no logo" instructions). Example: "a silhouette of a footballer celebrating with arms raised, strongly backlit against bright stadium floodlights at night, features lost in shadow, blurred background, cinematic silhouette photography, vertical composition".
- "posterHeadline": a short (max ~8 words), punchy, grammatically correct headline for on-screen text — eye-catching but not misleading, and not stating anything the source doesn't support.
- "posterSubtext": one short supporting line (a real stat/score/context detail from the snippet), or "Developing Story" / "Latest Update" if the facts are still uncertain — never a fabricated specific.
- "title": max 90 characters, must end with "#Shorts".
- "description": 2-3 sentences followed by 5-8 hashtags.
- "hashtags": an array of 5-8 hashtag strings (including the # symbol).

Respond with ONLY this JSON shape, no markdown fences, no extra text:
{ "script": "", "imagePrompt": "", "posterHeadline": "", "posterSubtext": "", "title": "", "description": "", "hashtags": [] }`;

function stripFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function callOllama(userContent, correctionNote, signal) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (correctionNote) {
    messages.push({ role: "user", content: userContent });
    messages.push({ role: "assistant", content: "(invalid previous output)" });
    messages.push({ role: "user", content: `Your last output was invalid because: ${correctionNote}. Respond with ONLY the JSON.` });
  } else {
    messages.push({ role: "user", content: userContent });
  }

  const res = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      stream: false,
      format: "json",
      options: { temperature: 0.7 },
      messages
    }),
    signal: timeoutSignal(config.ollama.timeoutMs, signal)
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  const raw = data?.message?.content ?? "";
  const cleaned = stripFences(raw);
  return JSON.parse(cleaned);
}

function fallbackContent(article) {
  const snippet = (article.snippet || article.title).trim();
  const words = snippet.split(/\s+/).filter(Boolean);
  let script = words.slice(0, 100).join(" ");
  if (wordCount(script) < 60) {
    script = `${article.title}. ${script}`.trim();
  }
  const title = `${article.title}`.slice(0, 88).trim() + " #Shorts";
  // Keep the on-screen headline short (~8 words) even though the full title can be longer.
  const posterHeadline = article.title.split(/\s+/).slice(0, 8).join(" ").slice(0, 45).trim();
  return {
    script,
    imagePrompt: GENERIC_IMAGE_PROMPT,
    posterHeadline,
    posterSubtext: "Latest Update",
    title,
    description: `${article.title}. Latest football news update.\n#Football #Soccer #Sports #News #Shorts`,
    hashtags: ["#Football", "#Soccer", "#Sports", "#News", "#Shorts"]
  };
}

/**
 * Generate voiceover script + image prompt + title/description/hashtags via Ollama,
 * with corrective retry and a guaranteed fallback template on repeated failure.
 * @param {object} article - { title, snippet, source }
 * @param {string} runDir - output/<runId>
 */
export async function generateContent(article, runDir, signal) {
  throwIfCancelled(signal);
  const userContent = `Title: ${article.title}\nSource: ${article.source}\nSnippet: ${article.snippet || "(none)"}`;

  let content = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await callOllama(userContent, attempt > 1 ? lastError : null, signal);
      const validationError = validateContent(parsed);
      if (validationError) {
        lastError = validationError;
        logger.warn({ attempt, validationError }, "step 02: Ollama output failed validation");
        continue;
      }
      content = parsed;
      break;
    } catch (err) {
      if (err.code === "cancelled") throw err;
      lastError = err.message;
      logger.warn({ attempt, err: err.message }, "step 02: Ollama call/parse failed");
    }
  }

  let usedFallback = false;
  if (!content) {
    logger.warn({ lastError }, "step 02: falling back to template content after repeated failures");
    content = fallbackContent(article);
    usedFallback = true;
  }

  content.imagePrompt = personNamePostCheck(article.title, content.imagePrompt);

  await fs.writeFile(path.join(runDir, "content.json"), JSON.stringify(content, null, 2));
  logger.info({ usedFallback, title: content.title }, "step 02: generate content complete");

  return { content, usedFallback };
}
