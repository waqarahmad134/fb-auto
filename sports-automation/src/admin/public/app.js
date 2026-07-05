const STEP_ORDER = [
  "fetchNews", "generateContent", "generateImage",
  "generateVoice", "generateSubtitles", "assembleVideo",
  "postFacebook"
];

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

function badge(status) {
  return `<span class="badge badge-${status}">${status.replace(/_/g, " ")}</span>`;
}

function stepChips(stepResults) {
  const byName = Object.fromEntries((stepResults || []).map((s) => [s.step, s]));
  return `<div class="steps">${STEP_ORDER.map((name) => {
    const s = byName[name];
    if (!s) return `<span class="step-chip" title="${name}: not reached">·</span>`;
    const cls = s.ok ? "ok" : "fail";
    const label = name.replace(/[a-z]/g, "").slice(0, 2) || name[0].toUpperCase();
    return `<span class="step-chip ${cls}" title="${name}: ${s.ok ? "ok" : "failed"}">${label}</span>`;
  }).join("")}</div>`;
}

async function loadStats() {
  const stats = await api("/api/stats");
  const cards = [
    { label: "Success", value: stats.runs.success || 0 },
    { label: "Failed", value: stats.runs.failed || 0 },
    { label: "No New Content", value: stats.runs.no_new_content || 0 },
    { label: "Running", value: stats.runs.running || 0 },
    { label: "Pending Articles", value: stats.pendingArticles || 0 }
  ];
  document.getElementById("stats").innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`)
    .join("");
}

function hasVideo(run) {
  return (run.stepResults || []).some((s) => s.step === "assembleVideo" && s.ok);
}

function facebookCell(run) {
  if (run.facebookVideoId) return `<span class="muted">${run.facebookVideoId}</span>`;
  if (hasVideo(run) && run.status !== "running") {
    return `<button class="btn btn-small btn-primary" data-action="upload-fb" data-run-id="${run.runId}">Upload</button>`;
  }
  return `<span class="muted">-</span>`;
}

async function postToFacebook(runId, button) {
  if (!confirm("Post this video to your Facebook Page now? This publishes publicly and can't be undone from here.")) return;
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    const result = await api(`/api/runs/${runId}/post-facebook`, { method: "POST" });
    if (result.ok) {
      button.textContent = "Posted ✓";
    } else {
      alert(`Facebook upload failed: ${result.reason}`);
      button.disabled = false;
      button.textContent = "Upload";
    }
  } catch (err) {
    alert(`Facebook upload failed: ${err.message}`);
    button.disabled = false;
    button.textContent = "Upload";
  }
  refreshAll();
}

async function loadRuns() {
  const runs = await api("/api/runs?limit=30");
  const body = document.getElementById("runs-body");
  if (runs.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No runs yet. Click "Run Now" or wait for the next cron tick.</td></tr>`;
    return;
  }
  body.innerHTML = runs.map((r) => `
    <tr data-run-id="${r.runId}">
      <td>${fmtDate(r.startedAt)}</td>
      <td>${badge(r.status)}</td>
      <td class="muted">${r.articleUrl ? new URL(r.articleUrl).hostname : "-"}</td>
      <td>${stepChips(r.stepResults)}</td>
      <td>${facebookCell(r)}</td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-run-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="upload-fb"]')) return;
      openRunDrawer(row.dataset.runId);
    });
  });
  body.querySelectorAll('[data-action="upload-fb"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      postToFacebook(btn.dataset.runId, btn);
    });
  });
}

async function loadArticles() {
  const articles = await api("/api/articles?limit=50");
  const body = document.getElementById("articles-body");
  if (articles.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No articles fetched yet.</td></tr>`;
    return;
  }
  body.innerHTML = articles.map((a) => `
    <tr>
      <td><a href="${a.url}" target="_blank" rel="noopener">${a.title}</a></td>
      <td class="muted">${a.source}</td>
      <td class="muted">${fmtDate(a.publishedAt)}</td>
      <td>${badge(a.status)}</td>
    </tr>
  `).join("");
}

async function openRunDrawer(runId) {
  const run = await api(`/api/runs/${runId}`);
  const content = document.getElementById("drawer-content");

  const timeline = STEP_ORDER.map((name) => {
    const s = (run.stepResults || []).find((x) => x.step === name);
    if (!s) return `<div class="timeline-row muted">${name} — not reached</div>`;
    return `<div class="timeline-row">
      ${s.ok ? "✅" : "❌"} <strong>${name}</strong>
      <span class="muted">${s.durationMs}ms</span>
      ${s.meta && Object.keys(s.meta).length ? `<span class="muted">${JSON.stringify(s.meta)}</span>` : ""}
    </div>`;
  }).join("");

  let scriptHtml = "";
  if (run.artifacts?.["content.json"]) {
    try {
      const contentRes = await fetch(run.artifacts["content.json"]);
      const c = await contentRes.json();
      scriptHtml = `
        <h3>Generated Content</h3>
        <div class="kv">
          <div class="k">Title</div><div>${c.title}</div>
          <div class="k">Hashtags</div><div>${(c.hashtags || []).join(" ")}</div>
        </div>
        <div class="script-box">${c.script}</div>
      `;
    } catch { /* content.json missing or unreadable — skip */ }
  }

  let mediaHtml = "";
  if (run.artifacts?.["final.mp4"]) {
    mediaHtml += `<div class="video-wrap"><video controls src="${run.artifacts["final.mp4"]}"></video></div>`;
  } else if (run.artifacts?.["background.png"]) {
    mediaHtml += `<img class="preview" src="${run.artifacts["background.png"]}" />`;
  }

  const canStop = run.status === "running";
  const canRetry = (run.status === "failed" || run.status === "cancelled") && run.articleUrl;
  const actionsHtml = canStop
    ? `<button class="btn btn-danger" data-action="stop" data-run-id="${run.runId}">Stop</button>`
    : canRetry
      ? `<button class="btn btn-primary" data-action="retry" data-run-id="${run.runId}">Continue</button>`
      : "";

  content.innerHTML = `
    <div class="drawer-title-row">
      <h2>${run.runId}</h2>
      ${actionsHtml}
    </div>
    <div class="kv">
      <div class="k">Status</div><div>${badge(run.status)}</div>
      <div class="k">Started</div><div>${fmtDate(run.startedAt)}</div>
      <div class="k">Finished</div><div>${fmtDate(run.finishedAt)}</div>
      <div class="k">Article</div><div>${run.articleUrl ? `<a href="${run.articleUrl}" target="_blank" rel="noopener">${run.articleUrl}</a>` : "-"}</div>
      ${run.error ? `<div class="k">Error</div><div>${run.error}</div>` : ""}
      <div class="k">Facebook</div><div>${facebookCell(run)}</div>
    </div>
    ${mediaHtml ? `<h3>Preview</h3>${mediaHtml}` : ""}
    ${scriptHtml}
    <h3>Step Timeline</h3>
    ${timeline}
  `;

  const stopBtn = content.querySelector('[data-action="stop"]');
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping…";
      await api(`/api/runs/${runId}/stop`, { method: "POST" });
      setTimeout(() => { openRunDrawer(runId); refreshAll(); }, 1000);
    });
  }
  const retryBtn = content.querySelector('[data-action="retry"]');
  if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "Continuing…";
      await api(`/api/runs/${runId}/retry`, { method: "POST" });
      setTimeout(() => { openRunDrawer(runId); refreshAll(); }, 1000);
    });
  }
  const uploadBtn = content.querySelector('[data-action="upload-fb"]');
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => postToFacebook(runId, uploadBtn));
  }

  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-backdrop").classList.add("open");
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-backdrop").classList.remove("open");
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

async function refreshAll() {
  await Promise.all([loadStats(), loadRuns(), loadArticles()]);
}

function init() {
  setupTabs();
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);

  const triggerBtn = document.getElementById("trigger-btn");
  triggerBtn.addEventListener("click", async () => {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "Triggered…";
    try {
      await api("/api/trigger", { method: "POST" });
    } finally {
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.textContent = "Run Now";
      }, 3000);
    }
  });

  refreshAll();
  setInterval(refreshAll, 5000);
}

init();
