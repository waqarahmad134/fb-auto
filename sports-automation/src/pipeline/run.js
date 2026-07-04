import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import logger from "../utils/logger.js";
import { setArticleStatus } from "../db/articles.js";
import { anyRunning, createRun, appendStepResult, updateRun } from "../db/runs.js";
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

function recordStep(runId, step, ok, durationMs, meta = {}) {
  appendStepResult(runId, { step, ok, durationMs, meta });
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

  if (anyRunning()) {
    logger.warn("previous run still marked running in DB — skipping this tick");
    return;
  }

  runningInProcess = true;
  const runId = makeRunId();
  const runDir = path.resolve("output", runId);
  await fs.mkdir(runDir, { recursive: true });

  createRun({ runId, startedAt: new Date(), status: "running" });
  let article = null;
  let uploadedAnywhere = false;

  try {
    // Step 01 — fetch news
    let step01;
    try {
      const { durationMs, result } = await timed(() => fetchNews());
      recordStep(runId, "fetchNews", true, durationMs, { newCount: result.newCount });
      step01 = result;
    } catch (err) {
      recordStep(runId, "fetchNews", false, 0, { error: err.message });
      throw err;
    }

    article = step01.article;
    if (!article) {
      updateRun(runId, { status: "no_new_content", finishedAt: new Date() });
      logger.info("no new articles — run complete");
      return;
    }

    updateRun(runId, { articleUrl: article.url });

    // Step 02 — generate content (Ollama)
    const { durationMs: d02, result: r02 } = await timed(() => generateContent(article, runDir));
    recordStep(runId, "generateContent", true, d02, { usedFallback: r02.usedFallback });
    const { content } = r02;

    // Step 03 — generate image (Pollinations)
    const { durationMs: d03, result: r03 } = await timed(() => generateImage(content.imagePrompt, runDir));
    recordStep(runId, "generateImage", true, d03, { usedFallback: r03.usedFallback });

    // Step 04 — generate voice (Piper)
    const { durationMs: d04, result: r04 } = await timed(() => generateVoice(content.script, runDir));
    recordStep(runId, "generateVoice", true, d04, { duration: r04.duration });

    // Step 05 — generate subtitles
    const { durationMs: d05, result: r05 } = await timed(() => generateSubtitles(content.script, r04.duration, runDir));
    recordStep(runId, "generateSubtitles", true, d05, { cueCount: r05.cueCount });

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
    recordStep(runId, "assembleVideo", true, d06, { duration: r06.duration });

    // Step 07 — upload YouTube
    let ytResult;
    try {
      const { durationMs: d07, result } = await timed(() => uploadYouTube({ videoPath: r06.videoPath, content }));
      ytResult = result;
      recordStep(runId, "uploadYouTube", true, d07, { videoId: ytResult.videoId, skipped: ytResult.skipped });
      if (ytResult.videoId) {
        updateRun(runId, { youtubeVideoId: ytResult.videoId });
        uploadedAnywhere = true;
      }
    } catch (err) {
      recordStep(runId, "uploadYouTube", false, 0, { error: err.message, code: err.code || null });
      if (err.code === "youtube_quota") {
        updateRun(runId, { status: "failed", error: "youtube_quota", finishedAt: new Date() });
        logger.error("YouTube quota exceeded — not retrying");
        return;
      }
      throw err;
    }

    // Step 08 — post Facebook (failure here is non-fatal if YouTube succeeded)
    let finalStatus;
    try {
      const { durationMs: d08, result: r08 } = await timed(() => postFacebook({ videoPath: r06.videoPath, content }));
      recordStep(runId, "postFacebook", true, d08, { videoId: r08.videoId, skipped: r08.skipped });
      if (r08.videoId) {
        updateRun(runId, { facebookVideoId: r08.videoId });
        uploadedAnywhere = true;
      }
      finalStatus = "success";
      updateRun(runId, { status: "success" });
    } catch (err) {
      recordStep(runId, "postFacebook", false, 0, { error: err.message });
      logger.error({ err: err.message }, "Facebook post failed — YouTube already succeeded, marking partial_success");
      finalStatus = "partial_success";
      updateRun(runId, { status: "partial_success", error: `facebook: ${err.message}` });
    }

    setArticleStatus(article.url, "done", runId);
    updateRun(runId, { finishedAt: new Date() });
    logger.info({ runId, status: finalStatus }, "run complete");
  } catch (err) {
    logger.error({ runId, err: err.message, stack: err.stack }, "run failed");
    try {
      updateRun(runId, { status: "failed", error: err.message, finishedAt: new Date() });
      // Never roll an article back to pending once an upload has happened —
      // that would cause it to be reprocessed and re-posted.
      if (article && !uploadedAnywhere) {
        setArticleStatus(article.url, "pending");
      }
    } catch (persistErr) {
      logger.error({ err: persistErr.message }, "failed to persist run failure state");
    }
  } finally {
    runningInProcess = false;
  }
}
