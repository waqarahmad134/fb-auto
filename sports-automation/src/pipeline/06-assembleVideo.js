import fs from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import logger from "../utils/logger.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const MAX_DURATION = 59;
const MIN_OUTPUT_BYTES = 100 * 1024;

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

/** Escape a filesystem path for use as an ffmpeg filter argument (subtitles=). */
function escapeForFilter(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/**
 * Assemble the final 1080x1920 vertical video: background image with Ken Burns
 * zoom, voiceover mixed with ducked background music, burned-in subtitles.
 */
export async function assembleVideo({ imagePath, audioPath, subsPath, audioDuration, runDir }) {
  const outputPath = path.join(runDir, "final.mp4");
  const duration = Math.min(audioDuration + 0.5, MAX_DURATION);
  const totalFrames = Math.max(Math.round(duration * FPS), 1);
  const zoomStep = (0.12 / totalFrames).toFixed(8);

  const musicPath = await pickRandomMusic();

  const command = ffmpeg();
  command.input(imagePath).inputOptions(["-loop 1"]);
  command.input(audioPath);
  if (musicPath) command.input(musicPath).inputOptions(["-stream_loop -1"]);

  const videoFilter =
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},` +
    `zoompan=z='min(zoom+${zoomStep},1.12)':d=${totalFrames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
    `subtitles='${escapeForFilter(subsPath)}':force_style='FontSize=16,Bold=1,Alignment=2,MarginV=60,OutlineColour=&H80000000,BorderStyle=3'[vout]`;

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
    command
      .on("start", (cmd) => logger.info({ cmd }, "step 06: ffmpeg command"))
      .on("error", (err, _stdout, stderr) => reject(new Error(`ffmpeg failed: ${err.message}. stderr: ${stderr}`)))
      .on("end", resolve)
      .run();
  });

  const stat = await fs.stat(outputPath);
  if (stat.size < MIN_OUTPUT_BYTES) {
    throw new Error(`final.mp4 is suspiciously small (${stat.size} bytes)`);
  }

  logger.info({ outputPath, duration, size: stat.size, hasMusic: !!musicPath }, "step 06: video assembled");
  return { videoPath: outputPath, duration };
}
