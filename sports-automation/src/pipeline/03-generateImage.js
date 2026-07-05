import fs from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { Jimp } from "jimp";
import config from "../config.js";
import logger from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import { timeoutSignal, throwIfCancelled } from "../utils/cancellation.js";
import { extractOgImage } from "./image-extraction.js";
import { isUniformColorBand } from "../utils/letterbox.js";

const MIN_VALID_BYTES = 20 * 1024;
const FETCH_TIMEOUT_MS = 90000;
const ARTICLE_PAGE_TIMEOUT_MS = 15000;
const LETTERBOX_STRIP_FRACTION = 0.04;

async function downloadImage(url, destPath, signal, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetch(url, { signal: timeoutSignal(timeoutMs, signal) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`non-image content-type "${contentType}" from ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length <= MIN_VALID_BYTES) {
    throw new Error(`image too small (${buffer.length} bytes) from ${url}`);
  }

  await fs.writeFile(destPath, buffer);
  return destPath;
}

async function fetchArticleOgImageUrl(articleUrl, signal) {
  const res = await fetch(articleUrl, { signal: timeoutSignal(ARTICLE_PAGE_TIMEOUT_MS, signal) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching article page`);
  const html = await res.text();
  const imageUrl = extractOgImage(html);
  if (!imageUrl) throw new Error("no og:image found on article page");
  return imageUrl;
}

function sampleRowPixels(bitmap, yStart, yEnd) {
  const { width, data } = bitmap;
  const step = Math.max(1, Math.floor(width / 60));
  const pixels = [];
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      pixels.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  return pixels;
}

/**
 * Detect a baked-in letterbox/pillarbox border — the signature of a social-share
 * card template (e.g. a news outlet's branded "GOSSIP" graphic with black bars top
 * and bottom), as opposed to a genuine photo. Real photos always have some texture
 * even in dark regions (a night sky has gradient/noise); a template border is a
 * perfectly flat color.
 */
async function hasLetterboxBorder(imagePath) {
  const image = await Jimp.read(imagePath);
  const { height } = image.bitmap;
  const stripHeight = Math.max(1, Math.round(height * LETTERBOX_STRIP_FRACTION));

  const topBand = sampleRowPixels(image.bitmap, 0, stripHeight);
  const bottomBand = sampleRowPixels(image.bitmap, height - stripHeight, height);
  return isUniformColorBand(topBand) || isUniformColorBand(bottomBand);
}

async function rejectIfLetterboxed(imagePath) {
  if (await hasLetterboxBorder(imagePath)) {
    throw new Error("image has a baked-in letterbox/border band — likely a branded social-share graphic, not a neutral photo");
  }
}

/** Try the real photo the RSS feed provided, then the article page's og:image tag. */
async function tryArticleImage(article, destPath, signal) {
  if (article?.imageUrl) {
    try {
      await downloadImage(article.imageUrl, destPath, signal);
      await rejectIfLetterboxed(destPath);
      return destPath;
    } catch (err) {
      if (err.code === "cancelled") throw err;
      logger.warn({ err: err.message }, "step 03: RSS-provided image failed, trying article page og:image");
    }
  }
  const ogImageUrl = await fetchArticleOgImageUrl(article.url, signal);
  await downloadImage(ogImageUrl, destPath, signal);
  await rejectIfLetterboxed(destPath);
  return destPath;
}

async function fetchPollinationsImage(prompt, destPath, signal) {
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `${config.pollinations.baseUrl}/${encodeURIComponent(prompt)}?width=${config.pollinations.width}&height=${config.pollinations.height}&nologo=true&seed=${seed}`;

  const res = await fetch(url, { signal: timeoutSignal(FETCH_TIMEOUT_MS, signal) });
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
 * Generate the background image. Tries, in order:
 *   1. The real photo from the article (RSS-embedded image, then the article page's
 *      og:image) — only if config.useArticleImage is enabled. NOTE: real news photos
 *      show identifiable people/team crests and are typically licensed to the
 *      publication, not you — this carries copyright/publicity-rights risk.
 *   2. An AI-generated image via Pollinations.ai.
 *   3. An ffmpeg-generated gradient, so this step can never fail the run.
 * @param {string} imagePrompt
 * @param {{ url: string, imageUrl?: string }} article
 * @param {string} runDir - output/<runId>
 */
export async function generateImage(imagePrompt, article, runDir, signal) {
  throwIfCancelled(signal);
  const destPath = path.join(runDir, "background.png");

  if (config.useArticleImage) {
    try {
      await tryArticleImage(article, destPath, signal);
      logger.info({ destPath, articleUrl: article.url }, "step 03: using real image from article");
      return { imagePath: destPath, source: "article" };
    } catch (err) {
      if (err.code === "cancelled") throw err;
      logger.warn({ err: err.message }, "step 03: no usable article image — generating AI image instead");
    }
  }

  try {
    await retry(() => fetchPollinationsImage(imagePrompt, destPath, signal), {
      attempts: 3,
      baseDelayMs: 2000,
      label: "pollinations-image"
    });
    logger.info({ destPath }, "step 03: image generated via Pollinations");
    return { imagePath: destPath, source: "pollinations" };
  } catch (err) {
    if (err.code === "cancelled") throw err;
    logger.warn({ err: err.message }, "step 03: Pollinations failed after retries — using gradient fallback");
    await generateGradientFallback(destPath);
    logger.info({ destPath }, "step 03: gradient fallback image generated");
    return { imagePath: destPath, source: "gradient" };
  }
}
