import { spawn } from "node:child_process";
import fs from "node:fs";
import config from "../src/config.js";
import logger from "../src/utils/logger.js";

async function checkFfmpeg() {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
}

async function checkOllama() {
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const hasModel = models.some((m) => m === config.ollama.model || m.startsWith(config.ollama.model.split(":")[0]));
    if (!hasModel) {
      return { ok: false, reason: `model "${config.ollama.model}" not pulled. Run: ollama pull ${config.ollama.model}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function checkPiper() {
  const binExists = fs.existsSync(config.piper.bin) || fs.existsSync(`${config.piper.bin}.exe`);
  const voiceExists = fs.existsSync(config.piper.voice);
  const configExists = fs.existsSync(`${config.piper.voice}.json`);
  return { binExists, voiceExists, configExists };
}

export async function runDepChecks({ exitOnFailure = true } = {}) {
  const results = [];

  const ffmpegOk = await checkFfmpeg();
  results.push({
    name: "ffmpeg",
    ok: ffmpegOk,
    hint: "Install ffmpeg and add it to PATH: https://ffmpeg.org/download.html"
  });

  const ollama = await checkOllama();
  results.push({
    name: "ollama",
    ok: ollama.ok,
    hint: ollama.ok ? null : `Ollama unreachable or model missing at ${config.ollama.baseUrl}. ${ollama.reason || ""} Install from ollama.com, then: ollama pull ${config.ollama.model}`
  });

  const piper = checkPiper();
  const piperOk = piper.binExists && piper.voiceExists && piper.configExists;
  results.push({
    name: "piper",
    ok: piperOk,
    hint: piperOk
      ? null
      : `Piper binary/voice missing. Expected binary at ${config.piper.bin} and voice at ${config.piper.voice} (+ .json config). Download from the Piper releases/voices repo into assets/piper/.`
  });

  // No database check needed: SQLite is embedded (better-sqlite3) and the DB file
  // is created on first connect — there's no separate server to reach.

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.ok) {
      logger.info({ check: r.name }, `[OK] ${r.name}`);
    } else {
      logger.error({ check: r.name, hint: r.hint }, `[FAIL] ${r.name} — ${r.hint}`);
    }
  }

  if (failed.length > 0 && exitOnFailure) {
    console.error(`\n${failed.length} dependency check(s) failed. Fix the above and re-run.`);
    process.exit(1);
  }

  return { ok: failed.length === 0, results };
}

// Allow running directly: node scripts/check-deps.js
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("check-deps.js")) {
  runDepChecks().then(({ ok }) => {
    if (ok) console.log("\nAll dependency checks passed.");
    process.exit(ok ? 0 : 1);
  });
}
