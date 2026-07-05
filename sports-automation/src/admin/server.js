import path from "node:path";
import fs from "node:fs";
import express from "express";
import { listRuns, getRun, countRunsByStatus } from "../db/runStore.js";
import { listArticles, countArticlesByStatus } from "../db/articleStore.js";
import { runPipeline, cancelRun, retryRun, postRunToFacebook } from "../pipeline/run.js";
import logger from "../utils/logger.js";

const OUTPUT_DIR = path.resolve("output");
const PUBLIC_DIR = path.resolve("src/admin/public");
const MEDIA_FILES = new Set(["background.png", "voice.wav", "subs.srt", "final.mp4", "content.json"]);

export function createAdminServer() {
  const app = express();
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/stats", async (req, res) => {
    const [counts, pendingArticles] = await Promise.all([
      countRunsByStatus(),
      countArticlesByStatus("pending")
    ]);
    res.json({ runs: counts, pendingArticles });
  });

  app.get("/api/runs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const runs = await listRuns({ limit });
    res.json(runs);
  });

  app.get("/api/runs/:runId", async (req, res) => {
    const run = await getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: "run not found" });

    const runDir = path.join(OUTPUT_DIR, req.params.runId);
    const artifacts = {};
    for (const name of MEDIA_FILES) {
      if (fs.existsSync(path.join(runDir, name))) {
        artifacts[name] = `/media/${req.params.runId}/${name}`;
      }
    }
    res.json({ ...run, artifacts });
  });

  app.get("/media/:runId/:filename", (req, res) => {
    const { runId, filename } = req.params;
    if (!MEDIA_FILES.has(filename) || /[\\/]/.test(runId)) {
      return res.status(400).end();
    }
    const filePath = path.join(OUTPUT_DIR, runId, filename);
    if (!filePath.startsWith(OUTPUT_DIR) || !fs.existsSync(filePath)) {
      return res.status(404).end();
    }
    res.sendFile(filePath);
  });

  app.get("/api/articles", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const articles = await listArticles({ status: req.query.status, limit });
    res.json(articles);
  });

  app.post("/api/trigger", (req, res) => {
    logger.info("admin: manual run triggered");
    runPipeline().catch((err) => logger.error({ err: err.message }, "manually triggered run failed"));
    res.status(202).json({ triggered: true });
  });

  app.post("/api/runs/:runId/stop", (req, res) => {
    const stopped = cancelRun(req.params.runId);
    logger.info({ runId: req.params.runId, stopped }, "admin: stop requested");
    res.json({ stopped });
  });

  app.post("/api/runs/:runId/retry", async (req, res) => {
    logger.info({ runId: req.params.runId }, "admin: retry requested");
    retryRun(req.params.runId)
      .then((result) => {
        if (!result.ok) logger.warn({ runId: req.params.runId, reason: result.reason }, "retry did not start");
      })
      .catch((err) => logger.error({ runId: req.params.runId, err: err.message }, "retried run failed"));
    res.status(202).json({ triggered: true });
  });

  app.post("/api/runs/:runId/post-facebook", async (req, res) => {
    logger.info({ runId: req.params.runId }, "admin: manual Facebook upload requested");
    const result = await postRunToFacebook(req.params.runId);
    if (!result.ok) logger.warn({ runId: req.params.runId, reason: result.reason }, "manual Facebook upload failed");
    res.json(result);
  });

  return app;
}

export function startAdminServer(port) {
  const app = createAdminServer();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info({ port }, "admin panel listening");
      resolve(server);
    });
  });
}
