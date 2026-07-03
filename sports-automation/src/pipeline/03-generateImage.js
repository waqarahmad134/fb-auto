import fs from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import config from "../config.js";
import logger from "../utils/logger.js";
import { retry } from "../utils/retry.js";

const MIN_VALID_BYTES = 20 * 1024;
const FETCH_TIMEOUT_MS = 90000;

async function fetchPollinationsImage(prompt, destPath) {
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `${config.pollinations.baseUrl}/${encodeURIComponent(prompt)}?width=${config.pollinations.width}&height=${config.pollinations.height}&nologo=true&seed=${seed}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Pollinations returned non-image content-type: ${contentType}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length <= MIN_VALID_BYTES) {
    throw new Error(`Pollinations image too small (${buffer.length} bytes) — likely an error placeholder`);
  }

  await fs.writeFile(destPath, buffer);
  return destPath;
}

function generateGradientFallback(destPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`color=c=0x1a1a2e:s=${config.pollinations.width}x${config.pollinations.height}`)
      .inputFormat("lavfi")
      .outputOptions(["-frames:v 1"])
      .videoFilters("geq=r='128+80*sin(2*PI*X/W)':g='60+40*sin(2*PI*Y/H)':b='140+60*cos(2*PI*(X+Y)/(W+H))'")
      .output(destPath)
      .on("end", () => resolve(destPath))
      .on("error", reject)
      .run();
  });
}

/**
 * Generate the background image via Pollinations.ai; fall back to an
 * ffmpeg-generated gradient if the free service is unavailable or returns junk.
 * @param {string} imagePrompt
 * @param {string} runDir - output/<runId>
 */
export async function generateImage(imagePrompt, runDir) {
  const destPath = path.join(runDir, "background.png");

  try {
    await retry(() => fetchPollinationsImage(imagePrompt, destPath), {
      attempts: 3,
      baseDelayMs: 2000,
      label: "pollinations-image"
    });
    logger.info({ destPath }, "step 03: image generated via Pollinations");
    return { imagePath: destPath, usedFallback: false };
  } catch (err) {
    logger.warn({ err: err.message }, "step 03: Pollinations failed after retries — using gradient fallback");
    await generateGradientFallback(destPath);
    logger.info({ destPath }, "step 03: gradient fallback image generated");
    return { imagePath: destPath, usedFallback: true };
  }
}
