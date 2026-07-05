import fs from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import config from "../config.js";
import logger from "../utils/logger.js";
import { CancelledError, throwIfCancelled } from "../utils/cancellation.js";
import { wrapText, truncateToMaxLines } from "../utils/textWrap.js";
import { detectFaces } from "./face-detect.js";
import { computeFaceCenter, mapPointThroughScaleCrop, buildZoompanFocusExpressions } from "../utils/faceZoom.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const MAX_DURATION = 59;
const MIN_OUTPUT_BYTES = 100 * 1024;
// Tuned empirically against the actual Anton font: rendered a real headline at
// fontsize 56 onto a wide canvas and measured its pixel width directly (~23px/char),
// same for subtext at fontsize 34 (~13px/char) — the original values here were a
// visual guess and were roughly 2x too narrow, wrapping headlines to 2 lines that
// easily fit on 1.
const HEADLINE_MAX_CHARS_PER_LINE = 38;
const SUBTEXT_MAX_CHARS_PER_LINE = 55;

// Solid black bars top/bottom, like a framed poster/thumbnail — all text (headline,
// subtext, subtitles) lives inside these bars, never overlapping the photo itself.
const TOP_BAR_HEIGHT = 300;
const BOTTOM_BAR_HEIGHT = 260;
const IMAGE_HEIGHT = HEIGHT - TOP_BAR_HEIGHT - BOTTOM_BAR_HEIGHT;

async function pickRandomMusic() {
  const musicDir = path.resolve("assets/music");
  let files;
  try {
    files = (await fs.readdir(musicDir)).filter((f) => f.toLowerCase().endsWith(".mp3"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return path.join(musicDir, files[Math.floor(Math.random() * files.length)]);
}

/** Escape a filesystem path for use as an ffmpeg filter argument (subtitles=, drawtext fontfile=/textfile=). */
function escapeForFilter(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/**
 * Write text to a plain file and return a drawtext filter segment referencing it via
 * textfile= — this sidesteps ffmpeg's notoriously fragile drawtext text= quoting/escaping
 * for apostrophes, colons, etc. in real headlines (e.g. "Dragons' play-off hopes"). No
 * box background is drawn — the text sits directly on the solid black bar.
 */
const LINE_SPACING = 6;
const MAX_TEXT_LINES = 2;

async function drawTextFilter({ text, filePath, fontSize, fontColor, y, maxCharsPerLine }) {
  const wrapped = truncateToMaxLines(wrapText(text, maxCharsPerLine), MAX_TEXT_LINES);
  await fs.writeFile(filePath, wrapped, "utf-8");
  const lineCount = wrapped.split("\n").length;
  const filter =
    `drawtext=fontfile='${escapeForFilter(config.fontPath)}':textfile='${escapeForFilter(filePath)}':` +
    `fontsize=${fontSize}:fontcolor=${fontColor}:line_spacing=${LINE_SPACING}:x=(w-text_w)/2:y=${y}`;
  // Approximate rendered block height so the next element can be positioned below it
  // without measuring the actual glyph metrics. Anton's real glyph ascent/descent
  // runs noticeably taller than the nominal fontSize, so pad generously (1.35x) —
  // an earlier 1.0x estimate left the subtext crowding the headline's last line.
  const blockHeight = lineCount * (fontSize * 1.35 + LINE_SPACING);
  return { filter, blockHeight };
}

/**
 * Find where the Ken Burns zoom should center: on the detected face (or the
 * midpoint of a group of faces) mapped into the (shrunk) image area's coordinate
 * space, or its center if no face is found (or detection fails — best-effort only).
 */
async function getZoomFocus(imagePath) {
  const { faces, imageSize } = await detectFaces(imagePath);
  const faceCenter = computeFaceCenter(faces);
  if (!faceCenter || !imageSize) {
    return { point: { x: WIDTH / 2, y: IMAGE_HEIGHT / 2 }, faceCount: faces.length };
  }
  const point = mapPointThroughScaleCrop(faceCenter, imageSize, { width: WIDTH, height: IMAGE_HEIGHT });
  return { point, faceCount: faces.length };
}

/**
 * Assemble the final 1080x1920 vertical video: a framed layout with solid black
 * bars top and bottom (like a poster/thumbnail template) — the photo, with a Ken
 * Burns zoom centered on a detected face/group of faces, sits in the shrunk middle
 * region; an original headline/subtext graphic lives in the top bar and subtitles
 * live in the bottom bar, so text never overlaps the image; voiceover mixed with
 * ducked background music.
 */
export async function assembleVideo({ imagePath, audioPath, subsPath, audioDuration, runDir, posterHeadline, posterSubtext }, signal) {
  throwIfCancelled(signal);
  const outputPath = path.join(runDir, "final.mp4");
  const duration = Math.min(audioDuration + 0.5, MAX_DURATION);
  const totalFrames = Math.max(Math.round(duration * FPS), 1);
  const zoomStep = (0.12 / totalFrames).toFixed(8);

  const { point: zoomFocus, faceCount } = await getZoomFocus(imagePath);
  const { x: zoomX, y: zoomY } = buildZoompanFocusExpressions(zoomFocus);
  logger.info({ imagePath, faceCount, zoomFocus }, "step 06: zoom focus computed");

  const musicPath = await pickRandomMusic();

  const command = ffmpeg();
  command.input(imagePath).inputOptions(["-loop 1"]);
  command.input(audioPath);
  if (musicPath) command.input(musicPath).inputOptions(["-stream_loop -1"]);

  const HEADLINE_Y = 50;
  const GAP_AFTER_HEADLINE = 20;

  let overlayFilters = "";
  if (posterHeadline?.trim()) {
    const headline = await drawTextFilter({
      text: posterHeadline,
      filePath: path.join(runDir, "headline.txt"),
      fontSize: 56,
      fontColor: "white",
      y: HEADLINE_Y,
      maxCharsPerLine: HEADLINE_MAX_CHARS_PER_LINE
    });
    overlayFilters += `,${headline.filter}`;

    if (posterSubtext?.trim()) {
      const subtext = await drawTextFilter({
        text: posterSubtext,
        filePath: path.join(runDir, "subtext.txt"),
        fontSize: 34,
        fontColor: "0xFFD24D",
        y: HEADLINE_Y + headline.blockHeight + GAP_AFTER_HEADLINE,
        maxCharsPerLine: SUBTEXT_MAX_CHARS_PER_LINE
      });
      overlayFilters += `,${subtext.filter}`;
    }
  }

  const videoFilter =
    `[0:v]scale=${WIDTH}:${IMAGE_HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${IMAGE_HEIGHT},` +
    `zoompan=z='min(zoom+${zoomStep},1.12)':x='${zoomX}':y='${zoomY}':d=${totalFrames}:s=${WIDTH}x${IMAGE_HEIGHT}:fps=${FPS},` +
    `pad=${WIDTH}:${HEIGHT}:0:${TOP_BAR_HEIGHT}:black` +
    `${overlayFilters},` +
    `subtitles='${escapeForFilter(subsPath)}':force_style='FontSize=18,Bold=1,Alignment=2,MarginV=100,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,PlayResX=${WIDTH},PlayResY=${HEIGHT}'[vout]`;

  const filters = [videoFilter];
  let audioMap;
  if (musicPath) {
    filters.push(`[2:a]volume=0.15,afade=t=out:st=${Math.max(duration - 1, 0)}:d=1[music]`);
    filters.push(`[1:a][music]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    audioMap = "[aout]";
  } else {
    audioMap = "1:a";
  }

  command.complexFilter(filters);
  command
    .outputOptions([
      "-map", "[vout]",
      "-map", audioMap,
      "-t", String(duration),
      "-r", String(FPS),
      "-preset", "medium",
      "-pix_fmt", "yuv420p"
    ])
    .videoCodec("libx264")
    .audioCodec("aac")
    .output(outputPath);

  await new Promise((resolve, reject) => {
    let cancelled = false;
    const onAbort = () => { cancelled = true; command.kill("SIGKILL"); };
    signal?.addEventListener("abort", onAbort, { once: true });

    command
      .on("start", (cmd) => logger.info({ cmd }, "step 06: ffmpeg command"))
      .on("error", (err, _stdout, stderr) => {
        signal?.removeEventListener("abort", onAbort);
        if (cancelled) return reject(new CancelledError());
        reject(new Error(`ffmpeg failed: ${err.message}. stderr: ${stderr}`));
      })
      .on("end", () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      })
      .run();
  });

  const stat = await fs.stat(outputPath);
  if (stat.size < MIN_OUTPUT_BYTES) {
    throw new Error(`final.mp4 is suspiciously small (${stat.size} bytes)`);
  }

  logger.info({ outputPath, duration, size: stat.size, hasMusic: !!musicPath, faceCount }, "step 06: video assembled");
  return { videoPath: outputPath, duration, faceCount };
}
