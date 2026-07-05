import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import logger from "../utils/logger.js";
import { markArticleStatus, getArticleByUrl } from "../db/articleStore.js";
import { createRun, patchRun, appendStepResult, hasRunningRun, getRun } from "../db/runStore.js";
import { getDurationSeconds } from "../utils/ffprobe.js";
import { CancelledError } from "../utils/cancellation.js";
import { fetchNews } from "./01-fetchNews.js";
import { generateContent } from "./02-generateContent.js";
import { generateImage } from "./03-generateImage.js";
import { generateVoice } from "./04-generateVoice.js";
import { generateSubtitles } from "./05-generateSubtitles.js";
import { assembleVideo } from "./06-assembleVideo.js";
import { postFacebook } from "./08-postFacebook.js";

let runningInProcess = false;
let activeRun = null; // { runId, controller }

function makeRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${ts}-${suffix}`;
}

async function timed(fn) {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Cancel the run in progress, if its runId matches. Kills the active Piper/ffmpeg child process. Returns true if a cancellation was issued. */
export function cancelRun(runId) {
  if (activeRun && activeRun.runId === runId) {
    activeRun.controller.abort(new CancelledError());
    return true;
  }
  return false;
}

/**
 * Runs steps 01-06 + 08 (fetch news through assemble video, then post to Facebook —
 * there is no YouTube step) for a run that already has a runId + output dir.
 * When resuming (resume: true), reuses artifacts from a previous attempt for any
 * step that already completed successfully and whose output file still exists,
 * instead of regenerating them from scratch.
 */
async function executePipeline(runId, runDir, { resume = false, existingSnapshot = null } = {}) {
  const controller = new AbortController();
  activeRun = { runId, controller };
  const { signal } = controller;

  const doneSteps = new Set((existingSnapshot?.stepResults || []).filter((s) => s.ok).map((s) => s.step));
  let article = null;
  let uploadedAnywhere = false;

  try {
    // Step 01 — fetch news (skipped entirely on resume; reuses the same article)
    if (!resume) {
      let step01;
      try {
        const { durationMs, result } = await timed(() => fetchNews());
        await appendStepResult(runId, { step: "fetchNews", ok: true, durationMs, meta: { newCount: result.newCount } });
        step01 = result;
      } catch (err) {
        await appendStepResult(runId, { step: "fetchNews", ok: false, durationMs: 0, meta: { error: err.message } });
        throw err;
      }

      article = step01.article;
      if (!article) {
        await patchRun(runId, { status: "no_new_content", finishedAt: new Date().toISOString() });
        logger.info("no new articles — run complete");
        return;
      }
      await patchRun(runId, { articleUrl: article.url });
    } else {
      article = await getArticleByUrl(existingSnapshot.articleUrl);
      if (!article) throw new Error(`article ${existingSnapshot.articleUrl} no longer exists`);
      logger.info({ runId, url: article.url }, "resuming run for existing article");
    }

    if (signal.aborted) throw signal.reason;

    // Step 02 — generate content (Ollama)
    let content;
    const contentPath = path.join(runDir, "content.json");
    if (resume && doneSteps.has("generateContent") && (await pathExists(contentPath))) {
      content = JSON.parse(await fs.readFile(contentPath, "utf-8"));
      logger.info("step 02: reusing content from previous attempt");
    } else {
      const { durationMs: d02, result: r02 } = await timed(() => generateContent(article, runDir, signal));
      await appendStepResult(runId, { step: "generateContent", ok: true, durationMs: d02, meta: { usedFallback: r02.usedFallback } });
      content = r02.content;
    }

    if (signal.aborted) throw signal.reason;

    // Step 03 — generate image (real article photo, then Pollinations, then gradient)
    const imagePath = path.join(runDir, "background.png");
    let r03;
    if (resume && doneSteps.has("generateImage") && (await pathExists(imagePath))) {
      r03 = { imagePath, source: "cached" };
      logger.info("step 03: reusing image from previous attempt");
    } else {
      const { durationMs: d03, result } = await timed(() => generateImage(content.imagePrompt, article, runDir, signal));
      await appendStepResult(runId, { step: "generateImage", ok: true, durationMs: d03, meta: { source: result.source } });
      r03 = result;
    }

    if (signal.aborted) throw signal.reason;

    // Step 04 — generate voice (Piper)
    const audioPath = path.join(runDir, "voice.wav");
    let r04;
    if (resume && doneSteps.has("generateVoice") && (await pathExists(audioPath))) {
      r04 = { audioPath, duration: await getDurationSeconds(audioPath) };
      logger.info("step 04: reusing voiceover from previous attempt");
    } else {
      const { durationMs: d04, result } = await timed(() => generateVoice(content.script, runDir, signal));
      await appendStepResult(runId, { step: "generateVoice", ok: true, durationMs: d04, meta: { duration: result.duration } });
      r04 = result;
    }

    if (signal.aborted) throw signal.reason;

    // Step 05 — generate subtitles (cheap — always regenerated against the current audio duration)
    const { durationMs: d05, result: r05 } = await timed(() => generateSubtitles(content.script, r04.duration, runDir));
    await appendStepResult(runId, { step: "generateSubtitles", ok: true, durationMs: d05, meta: { cueCount: r05.cueCount } });

    if (signal.aborted) throw signal.reason;

    // Step 06 — assemble video
    const videoPath = path.join(runDir, "final.mp4");
    let r06;
    if (resume && doneSteps.has("assembleVideo") && (await pathExists(videoPath))) {
      r06 = { videoPath, duration: r04.duration };
      logger.info("step 06: reusing assembled video from previous attempt");
    } else {
      const { durationMs: d06, result } = await timed(() =>
        assembleVideo(
          {
            imagePath: r03.imagePath,
            audioPath: r04.audioPath,
            subsPath: r05.subsPath,
            audioDuration: r04.duration,
            runDir,
            posterHeadline: content.posterHeadline,
            posterSubtext: content.posterSubtext
          },
          signal
        )
      );
      await appendStepResult(runId, { step: "assembleVideo", ok: true, durationMs: d06, meta: { duration: result.duration, faceCount: result.faceCount } });
      r06 = result;
    }

    if (signal.aborted) throw signal.reason;

    // Step 08 — post Facebook (the only publish target; skips gracefully if
    // FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN aren't configured, same as DRY_RUN)
    if (resume && doneSteps.has("postFacebook")) {
      logger.info("step 08: already posted in a previous attempt — not re-posting");
    } else {
      const { durationMs: d08, result: r08 } = await timed(() => postFacebook({ videoPath: r06.videoPath, content }, signal));
      await appendStepResult(runId, { step: "postFacebook", ok: true, durationMs: d08, meta: { videoId: r08.videoId, skipped: r08.skipped } });
      if (r08.videoId) {
        await patchRun(runId, { facebookVideoId: r08.videoId });
        uploadedAnywhere = true;
      }
    }

    await markArticleStatus(article.url, "done", { runId });
    await patchRun(runId, { status: "success", finishedAt: new Date().toISOString() });
    logger.info({ runId }, "run complete");
  } catch (err) {
    const cancelled = err.code === "cancelled" || signal.aborted;
    logger.error({ runId, err: err.message, cancelled }, cancelled ? "run cancelled by user" : "run failed");
    await patchRun(runId, { status: cancelled ? "cancelled" : "failed", error: err.message, finishedAt: new Date().toISOString() }).catch(() => {});

    // Never roll an article back to pending once an upload has happened —
    // that would cause it to be reprocessed and re-posted.
    if (article && !uploadedAnywhere) {
      await markArticleStatus(article.url, "pending").catch(() => {});
    }
  } finally {
    if (activeRun?.runId === runId) activeRun = null;
  }
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

  const alreadyRunning = await hasRunningRun();
  if (alreadyRunning) {
    logger.warn("previous run still marked running — skipping this tick");
    return;
  }

  runningInProcess = true;
  const runId = makeRunId();
  const runDir = path.resolve("output", runId);
  await fs.mkdir(runDir, { recursive: true });
  await createRun({ runId, startedAt: new Date().toISOString() });

  try {
    await executePipeline(runId, runDir, { resume: false });
  } finally {
    runningInProcess = false;
  }
}

/**
 * Manually posts an already-assembled run's video to Facebook on demand, without
 * re-running the rest of the pipeline. Used by the admin dashboard's per-run
 * "Upload to Facebook" button — e.g. for a run that succeeded before Facebook
 * credentials were configured, so it never actually posted.
 */
export async function postRunToFacebook(runId) {
  const run = await getRun(runId);
  if (!run) return { ok: false, reason: "run not found" };
  if (run.status === "running") return { ok: false, reason: "run is still in progress" };
  if (run.facebookVideoId) return { ok: false, reason: "this run has already been posted to Facebook" };

  const runDir = path.resolve("output", runId);
  const videoPath = path.join(runDir, "final.mp4");
  const contentPath = path.join(runDir, "content.json");
  if (!(await pathExists(videoPath))) return { ok: false, reason: "no final.mp4 found for this run" };
  if (!(await pathExists(contentPath))) return { ok: false, reason: "no content.json found for this run" };

  const content = JSON.parse(await fs.readFile(contentPath, "utf-8"));

  try {
    const { durationMs, result } = await timed(() => postFacebook({ videoPath, content }));
    await appendStepResult(runId, { step: "postFacebook", ok: true, durationMs, meta: { videoId: result.videoId, skipped: result.skipped, manual: true } });
    if (result.videoId) {
      await patchRun(runId, { facebookVideoId: result.videoId, status: "success" });
    }
    return { ok: true, result };
  } catch (err) {
    await appendStepResult(runId, { step: "postFacebook", ok: false, durationMs: 0, meta: { error: err.message, manual: true } });
    return { ok: false, reason: err.message };
  }
}

/**
 * Retries a failed or cancelled run, reusing whatever step artifacts already
 * exist in its output folder instead of regenerating them from scratch.
 */
export async function retryRun(runId) {
  if (runningInProcess) return { ok: false, reason: "another run is already in progress" };
  const alreadyRunning = await hasRunningRun();
  if (alreadyRunning) return { ok: false, reason: "another run is already in progress" };

  const existing = await getRun(runId);
  if (!existing) return { ok: false, reason: "run not found" };
  if (existing.status === "running") return { ok: false, reason: "run is already running" };
  if (!existing.articleUrl) return { ok: false, reason: "run has no associated article to retry" };

  runningInProcess = true;
  const runDir = path.resolve("output", runId);
  await fs.mkdir(runDir, { recursive: true });
  await patchRun(runId, { status: "running", error: null, finishedAt: null });

  try {
    await executePipeline(runId, runDir, { resume: true, existingSnapshot: existing });
    return { ok: true };
  } finally {
    runningInProcess = false;
  }
}
