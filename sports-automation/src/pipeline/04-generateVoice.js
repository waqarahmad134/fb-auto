import { spawn } from "node:child_process";
import path from "node:path";
import config from "../config.js";
import logger from "../utils/logger.js";
import { getDurationSeconds } from "../utils/ffprobe.js";

const MAX_TARGET_SECONDS = 57;

function runPiper(text, outputFile, lengthScale) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.piper.bin, [
      "--model", config.piper.voice,
      "--length-scale", String(lengthScale),
      "--output_file", outputFile
    ]);

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", (err) => reject(new Error(`Piper spawn failed: ${err.message}`)));
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Piper exited with code ${code}. stderr: ${stderr.trim()}`));
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/**
 * Generate voiceover audio for the script via Piper (local TTS).
 * Re-runs with a faster length-scale once if the result exceeds the target duration.
 * @param {string} script
 * @param {string} runDir - output/<runId>
 */
export async function generateVoice(script, runDir) {
  const outputFile = path.join(runDir, "voice.wav");

  let lengthScale = config.piper.lengthScale;
  await runPiper(script, outputFile, lengthScale);
  let duration = await getDurationSeconds(outputFile);

  if (duration > MAX_TARGET_SECONDS) {
    logger.warn({ duration }, "step 04: voiceover too long, re-running Piper with faster length-scale");
    lengthScale = Number((lengthScale * 0.9).toFixed(3));
    await runPiper(script, outputFile, lengthScale);
    duration = await getDurationSeconds(outputFile);
  }

  logger.info({ outputFile, duration, lengthScale }, "step 04: voiceover generated");
  return { audioPath: outputFile, duration };
}
