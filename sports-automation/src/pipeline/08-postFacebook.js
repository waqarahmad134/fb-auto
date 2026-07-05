import fs from "node:fs";
import fsp from "node:fs/promises";
import config from "../config.js";
import logger from "../utils/logger.js";
import { throwIfCancelled } from "../utils/cancellation.js";

// Facebook Graph API version — check https://developers.facebook.com/docs/graph-api/changelog
// for the current version and bump this constant when it's deprecated.
const GRAPH_API_VERSION = config.facebook.graphApiVersion;
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function startUploadSession(pageId, accessToken, signal) {
  const url = `${GRAPH_BASE}/${pageId}/video_reels?upload_phase=start&access_token=${accessToken}`;
  const res = await fetch(url, { method: "POST", signal });
  const data = await res.json();
  if (!res.ok) throw new Error(`Facebook start phase failed: ${JSON.stringify(data)}`);
  return { videoId: data.video_id, uploadUrl: data.upload_url };
}

async function uploadVideoBinary(uploadUrl, accessToken, videoPath, signal) {
  const stat = await fsp.stat(videoPath);
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      "Content-Type": "application/octet-stream",
      file_size: String(stat.size),
      offset: "0"
    },
    body: fs.readFileSync(videoPath),
    duplex: "half",
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`Facebook binary upload failed: ${JSON.stringify(data)}`);
  }
}

async function finishUploadSession(pageId, accessToken, videoId, description, signal) {
  const url = `${GRAPH_BASE}/${pageId}/video_reels`;
  const body = new URLSearchParams({
    access_token: accessToken,
    video_id: videoId,
    upload_phase: "finish",
    video_state: "PUBLISHED",
    description
  });
  const res = await fetch(url, { method: "POST", body, signal });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(`Facebook finish phase failed: ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Post the assembled video to the configured Facebook Page as a Reel.
 * @param {{ videoPath: string, content: { description: string } }} params
 */
export async function postFacebook({ videoPath, content }, signal) {
  if (config.dryRun) {
    logger.info("step 08: DRY RUN — skipped Facebook post");
    return { skipped: true, videoId: null };
  }

  const { pageId, pageAccessToken } = config.facebook;
  if (!pageId || !pageAccessToken) {
    logger.warn("step 08: SKIPPED — FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN not configured");
    return { skipped: true, videoId: null };
  }
  throwIfCancelled(signal);

  const { videoId, uploadUrl } = await startUploadSession(pageId, pageAccessToken, signal);
  logger.info({ videoId }, "step 08: Facebook upload session started");

  await uploadVideoBinary(uploadUrl, pageAccessToken, videoPath, signal);
  logger.info({ videoId }, "step 08: Facebook binary uploaded");

  await finishUploadSession(pageId, pageAccessToken, videoId, content.description, signal);
  logger.info({ videoId }, "step 08: posted to Facebook as Reel");

  return { skipped: false, videoId };
}
