import fs from "node:fs/promises";
import path from "node:path";
import logger from "../utils/logger.js";

const MAX_WORDS_PER_CUE = 5;
const GAP_SECONDS = 0.05;

/** Split a script into caption chunks of <= maxWords, breaking at punctuation where possible. */
export function chunkScript(script, maxWords = MAX_WORDS_PER_CUE) {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];

  for (const word of words) {
    current.push(word);
    const endsAtPunctuation = /[.,!?;:]$/.test(word);
    if (current.length >= maxWords || (endsAtPunctuation && current.length >= 2)) {
      chunks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current.join(" "));

  return chunks;
}

/** Distribute chunk timings proportionally to word count across totalDuration, with gaps between cues. */
export function buildCues(chunks, totalDurationSeconds, gapSeconds = GAP_SECONDS) {
  const wordCounts = chunks.map((c) => c.split(/\s+/).filter(Boolean).length);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const totalGapTime = gapSeconds * Math.max(chunks.length - 1, 0);
  const speakableDuration = Math.max(totalDurationSeconds - totalGapTime, 0.1);

  const cues = [];
  let t = 0;
  for (let i = 0; i < chunks.length; i++) {
    const share = totalWords > 0 ? wordCounts[i] / totalWords : 1 / chunks.length;
    const cueDuration = share * speakableDuration;
    const start = t;
    const end = start + cueDuration;
    cues.push({ text: chunks[i], start, end });
    t = end + gapSeconds;
  }
  return cues;
}

function formatSrtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msRem).padStart(3, "0")}`;
}

function cuesToSrt(cues) {
  return cues
    .map((cue, i) => `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

// SUBTITLE_PROVIDER switch: only "estimate" is implemented today.
// A local faster-whisper provider can be plugged in here later.
const providers = {
  estimate: (script, durationSeconds) => buildCues(chunkScript(script), durationSeconds)
};

/**
 * Generate subs.srt for the given script, timed against the measured audio duration.
 * @param {string} script
 * @param {number} durationSeconds
 * @param {string} runDir - output/<runId>
 */
export async function generateSubtitles(script, durationSeconds, runDir) {
  const provider = process.env.SUBTITLE_PROVIDER || "estimate";
  const generate = providers[provider] || providers.estimate;

  const cues = generate(script, durationSeconds);
  const srt = cuesToSrt(cues);
  const destPath = path.join(runDir, "subs.srt");
  await fs.writeFile(destPath, srt);

  logger.info({ destPath, cueCount: cues.length }, "step 05: subtitles generated");
  return { subsPath: destPath, cueCount: cues.length };
}
