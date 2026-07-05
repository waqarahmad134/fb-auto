import path from "node:path";
import config from "../config.js";
import { createJsonFile } from "./jsonFile.js";

const file = createJsonFile(path.resolve(config.dataDir, "runs.json"), []);

export async function createRun({ runId, startedAt }) {
  const run = {
    runId,
    articleUrl: null,
    startedAt,
    finishedAt: null,
    status: "running",
    stepResults: [],
    error: null,
    facebookVideoId: null
  };
  await file.mutate((runs) => { runs.push(run); });
  return { ...run };
}

export async function patchRun(runId, patch) {
  await file.mutate((runs) => {
    const run = runs.find((r) => r.runId === runId);
    if (run) Object.assign(run, patch);
  });
}

export async function appendStepResult(runId, stepResult) {
  await file.mutate((runs) => {
    const run = runs.find((r) => r.runId === runId);
    if (run) run.stepResults.push(stepResult);
  });
}

export async function getRun(runId) {
  const runs = await file.read();
  return runs.find((r) => r.runId === runId) || null;
}

export async function hasRunningRun() {
  const runs = await file.read();
  return runs.some((r) => r.status === "running");
}

export async function listRuns({ limit = 20 } = {}) {
  const runs = await file.read();
  return [...runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
}

export async function countRunsByStatus() {
  const runs = await file.read();
  const counts = {};
  for (const r of runs) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

/** Mark any run still "running" older than cutoffDate as "failed". Returns count recovered. */
export async function recoverStaleRunning(cutoffDate) {
  return file.mutate((runs) => {
    let recovered = 0;
    for (const r of runs) {
      if (r.status === "running" && new Date(r.startedAt) < cutoffDate) {
        r.status = "failed";
        r.error = "stale run recovered at startup";
        r.finishedAt = new Date().toISOString();
        recovered++;
      }
    }
    return recovered;
  });
}
