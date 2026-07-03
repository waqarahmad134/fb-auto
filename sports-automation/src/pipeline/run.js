import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import logger from "../utils/logger.js";
import Article from "../db/models/Article.js";
import Run from "../db/models/Run.js";
import { fetchNews } from "./01-fetchNews.js";
import { generateContent } from "./02-generateContent.js";
import { generateImage } from "./03-generateImage.js";
import { generateVoice } from "./04-generateVoice.js";
import { generateSubtitles } from "./05-generateSubtitles.js";
import { assembleVideo } from "./06-assembleVideo.js";
import { uploadYouTube } from "./07-uploadYouTube.js";
import { postFacebook } from "./08-postFacebook.js";

let runningInProcess = false;

function makeRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${ts}-${suffix}`;
}

async function recordStep(run, step, ok, durationMs, meta = {}) {
  run.stepResults.push({ step, ok, durationMs, meta });
  await run.save();
}

async function timed(fn) {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

/**
 * Orchestrates one full pipeline run: fetch -> generate -> assemble -> publish.
 * Sandboxed so a failure never propagates out and crashes the cron loop.
 */
export async function runPipeline() {
  if (runningInProcess) {
    logger.warn("previous run still in progress (in-process lock) — skipping this tick");
    return;
  }

  const alreadyRunning = await Run.exists({ status: "running" });
  if (alreadyRunning) {
    logger.warn("previous run still marked running in DB — skipping this tick");
    return;
  }

  runningInProcess = true;
  const runId = makeRunId();
  const runDir = path.resolve("output", runId);
  await fs.mkdir(runDir, { recursive: true });

  const run = await Run.create({ runId, startedAt: new Date(), status: "running" });
  let article = null;
  let uploadedAnywhere = false;

  try {
    // Step 01 — fetch news
    let step01;
    try {
      const { durationMs, result } = await timed(() => fetchNews());
      await recordStep(run, "fetchNews", true, durationMs, { newCount: result.newCount });
      step01 = result;
    } catch (err) {
      await recordStep(run, "fetchNews", false, 0, { error: err.message });
      throw err;
    }

    article = step01.article;
    if (!article) {
      run.status = "no_new_content";
      run.finishedAt = new Date();
      await run.save();
      logger.info("no new articles — run complete");
      return;
    }

    run.articleUrl = article.url;
    await run.save();

    // Step 02 — generate content (Ollama)
    const { durationMs: d02, result: r02 } = await timed(() => generateContent(article, runDir));
    await recordStep(run, "generateContent", true, d02, { usedFallback: r02.usedFallback });
    const { content } = r02;

    // Step 03 — generate image (Pollinations)
    const { durationMs: d03, result: r03 } = await timed(() => generateImage(content.imagePrompt, runDir));
    await recordStep(run, "generateImage", true, d03, { usedFallback: r03.usedFallback });

    // Step 04 — generate voice (Piper)
    const { durationMs: d04, result: r04 } = await timed(() => generateVoice(content.script, runDir));
    await recordStep(run, "generateVoice", true, d04, { duration: r04.duration });

    // Step 05 — generate subtitles
    const { durationMs: d05, result: r05 } = await timed(() => generateSubtitles(content.script, r04.duration, runDir));
    await recordStep(run, "generateSubtitles", true, d05, { cueCount: r05.cueCount });

    // Step 06 — assemble video
    const { durationMs: d06, result: r06 } = await timed(() =>
      assembleVideo({
        imagePath: r03.imagePath,
        audioPath: r04.audioPath,
        subsPath: r05.subsPath,
        audioDuration: r04.duration,
        runDir
      })
    );
    await recordStep(run, "assembleVideo", true, d06, { duration: r06.duration });

    // Step 07 — upload YouTube
    let ytResult;
    try {
      const { durationMs: d07, result } = await timed(() => uploadYouTube({ videoPath: r06.videoPath, content }));
      ytResult = result;
      await recordStep(run, "uploadYouTube", true, d07, { videoId: ytResult.videoId, skipped: ytResult.skipped });
      if (ytResult.videoId) {
        run.youtubeVideoId = ytResult.videoId;
        uploadedAnywhere = true;
        await run.save();
      }
    } catch (err) {
      await recordStep(run, "uploadYouTube", false, 0, { error: err.message, code: err.code || null });
      if (err.code === "youtube_quota") {
        run.status = "failed";
        run.error = "youtube_quota";
        run.finishedAt = new Date();
        await run.save();
        logger.error("YouTube quota exceeded — not retrying");
        return;
      }
      throw err;
    }

    // Step 08 — post Facebook (failure here is non-fatal if YouTube succeeded)
    try {
      const { durationMs: d08, result: r08 } = await timed(() => postFacebook({ videoPath: r06.videoPath, content }));
      await recordStep(run, "postFacebook", true, d08, { videoId: r08.videoId, skipped: r08.skipped });
      if (r08.videoId) {
        run.facebookVideoId = r08.videoId;
        uploadedAnywhere = true;
      }
      run.status = "success";
    } catch (err) {
      await recordStep(run, "postFacebook", false, 0, { error: err.message });
      logger.error({ err: err.message }, "Facebook post failed — YouTube already succeeded, marking partial_success");
      run.status = "partial_success";
      run.error = `facebook: ${err.message}`;
    }

    article.status = "done";
    article.runId = runId;
    await article.save();

    run.finishedAt = new Date();
    await run.save();
    logger.info({ runId, status: run.status }, "run complete");
  } catch (err) {
    logger.error({ runId, err: err.message, stack: err.stack }, "run failed");
    run.status = "failed";
    run.error = err.message;
    run.finishedAt = new Date();
    await run.save().catch(() => {});

    // Never roll an article back to pending once an upload has happened —
    // that would cause it to be reprocessed and re-posted.
    if (article && !uploadedAnywhere) {
      article.status = "pending";
      await article.save().catch(() => {});
    }
  } finally {
    runningInProcess = false;
  }
}
