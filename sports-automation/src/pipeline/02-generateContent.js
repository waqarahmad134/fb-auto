import fs from "node:fs/promises";
import path from "node:path";
import config from "../config.js";
import logger from "../utils/logger.js";
import { GENERIC_IMAGE_PROMPT, wordCount, validateContent, personNamePostCheck } from "./content-validation.js";

export { GENERIC_IMAGE_PROMPT, validateContent, personNamePostCheck } from "./content-validation.js";

const SYSTEM_PROMPT = `You are a scriptwriter for a football news Shorts channel. Given a news headline and snippet, produce a JSON object for one short vertical video.

Rules:
- "script": a 90-110 word voiceover script, conversational spoken tone, no headlines, do NOT start with phrases like "In a recent article" or "According to", hook the viewer in the first sentence.
- "imagePrompt": a generic background image scene. It must NOT name or describe any real, identifiable person, and must NOT reference any team crest or logo. Use generic scenes only, e.g. "a footballer in a red kit celebrating under stadium floodlights, cinematic lighting, vertical composition".
- "title": max 90 characters, must end with "#Shorts".
- "description": 2-3 sentences followed by 5-8 hashtags.
- "hashtags": an array of 5-8 hashtag strings (including the # symbol).

Respond with ONLY this JSON shape, no markdown fences, no extra text:
{ "script": "", "imagePrompt": "", "title": "", "description": "", "hashtags": [] }`;

function stripFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function callOllama(userContent, correctionNote) {
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
    signal: AbortSignal.timeout(config.ollama.timeoutMs)
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
  return {
    script,
    imagePrompt: GENERIC_IMAGE_PROMPT,
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
export async function generateContent(article, runDir) {
  const userContent = `Title: ${article.title}\nSource: ${article.source}\nSnippet: ${article.snippet || "(none)"}`;

  let content = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await callOllama(userContent, attempt > 1 ? lastError : null);
      const validationError = validateContent(parsed);
      if (validationError) {
        lastError = validationError;
        logger.warn({ attempt, validationError }, "step 02: Ollama output failed validation");
        continue;
      }
      content = parsed;
      break;
    } catch (err) {
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
