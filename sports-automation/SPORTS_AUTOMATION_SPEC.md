# PROJECT SPEC — Football Shorts Automation Pipeline (ZERO-COST EDITION)

> **Implementation note:** the built project deviates from this spec in one place —
> storage is plain local JSON files (`data/articles.json`, `data/runs.json`) instead
> of MongoDB, by later request, to keep everything running on-PC with zero external
> services. An admin dashboard (`src/admin/`) was also added on top of this spec.
> See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current, accurate picture.

> **Purpose of this file:** This is the master build spec. Read it fully before writing any code.
> Build the project phase-by-phase in the order listed in [Build Phases](#build-phases).
> This edition uses **100% free resources**: Ollama (local LLM), Pollinations.ai (free image gen, no key), Piper (local TTS). The only external accounts needed are YouTube and Facebook — both free.
> Do not skip the deduplication, error-handling, or logging requirements — they are what make this safe to run unattended 24/7.

---

## 1. What We Are Building

A Node.js service that runs 24/7 on a local PC and, **every hour**, fully automatically:

1. Pulls the latest football news from RSS feeds (ESPN, BBC Sport, Sky Sports)
2. Picks ONE new (not-yet-processed) story
3. Uses **Ollama (local LLM)** to generate: a ~100-word voiceover script + an image prompt + a video title/description/hashtags (single structured JSON call)
4. Generates a background image via **Pollinations.ai** (free HTTP GET, no API key)
5. Generates voiceover audio with **Piper TTS** (local, offline)
6. Generates subtitles (word-timing estimator — free, zero dependencies)
7. Assembles a 1080x1920 vertical video with FFmpeg (image + Ken Burns zoom + voiceover + ducked background music + burned-in subtitles)
8. Uploads to YouTube as a Short (YouTube Data API v3 — free quota)
9. Posts to a Facebook Page as a Reel (Meta Graph API — free)
10. Records everything in MongoDB so nothing is ever processed twice

Zero human interaction after startup. Zero recurring cost.

---

## 2. Tech Stack

| Concern | Choice | Cost |
|---|---|---|
| Runtime | Node.js 20+, ES Modules (`"type": "module"`) | free |
| Language | JavaScript (no TypeScript) | — |
| Scheduler | `node-cron` | free |
| Process manager (24/7) | PM2 (`pm2 start ecosystem.config.cjs`) | free |
| Database | Local MongoDB via Mongoose | free |
| RSS | `rss-parser` | free |
| LLM | **Ollama** local server, REST API at `http://localhost:11434` — call with plain `fetch`, no SDK. Default model `llama3.1:8b` (env-configurable) | free |
| Image generation | **Pollinations.ai** — `GET https://image.pollinations.ai/prompt/<urlencoded prompt>?width=768&height=1344&nologo=true&seed=<random>` returns the image bytes directly. No key, no account | free |
| TTS | **Piper** — local binary + `.onnx` voice model, invoked via `child_process.spawn`, outputs WAV | free |
| Subtitles | Built-in word-timing estimator (proportional distribution over measured audio duration) | free |
| Video | `fluent-ffmpeg` (requires ffmpeg on PATH — verify at startup) | free |
| YouTube | `googleapis` (OAuth2 with refresh token) | free (quota-limited) |
| Facebook | Meta Graph API via `fetch` | free |
| Logging | `pino` (+ `pino-pretty` in dev), per-run JSON logs in `logs/` | free |
| Config | `dotenv`, validated at startup | free |

### One-time local installs (document in README with exact commands)
1. **Ollama**: install from ollama.com, then `ollama pull llama3.1:8b`. Needs ~8 GB RAM for the 8B model; if the PC has less, use `llama3.2:3b` or `phi3:mini`.
2. **Piper**: download the release binary for the OS + one voice model (e.g. `en_US-ryan-high.onnx` + its `.json` config) from the piper releases/voices repo into `assets/piper/`.
3. **FFmpeg** on PATH.
4. **MongoDB** local service.

---

## 3. Folder Structure

Create exactly this structure:

```
sports-automation/
├── .env.example              # every env var with comments, no real values
├── .gitignore                # node_modules, .env, output/, logs/, tokens/, assets/piper/*.onnx
├── package.json
├── ecosystem.config.cjs      # PM2 config: autorestart, max_memory_restart, time
├── README.md                 # setup instructions (generate at the end)
├── SPORTS_AUTOMATION_SPEC.md # this file
├── assets/
│   ├── music/                # user drops royalty-free .mp3 files here; pipeline picks one at random
│   └── piper/                # piper binary + voice .onnx + .onnx.json live here
├── output/                   # generated artifacts, one subfolder per run: output/<runId>/
├── logs/
├── tokens/                   # youtube_token.json (OAuth refresh token), gitignored
├── scripts/
│   ├── youtube-auth.js       # one-time interactive OAuth flow to obtain refresh token
│   ├── check-deps.js         # verifies ffmpeg, ollama reachable, piper binary + voice exist, mongo reachable
│   └── test-run.js           # run the full pipeline ONCE immediately, skip cron (for testing)
└── src/
    ├── index.js              # entry: validate env, run dep checks, connect DB, start cron, graceful shutdown
    ├── config.js             # loads + validates .env (fail fast with clear message if missing)
    ├── db/
    │   ├── connect.js
    │   └── models/
    │       ├── Article.js    # url (unique), title, source, publishedAt, status, runId
    │       └── Run.js        # runId, startedAt, finishedAt, status, stepResults[], error
    ├── pipeline/
    │   ├── run.js            # orchestrator: executes steps in order, updates Run doc after each step
    │   ├── 01-fetchNews.js
    │   ├── 02-generateContent.js   # Ollama call → { script, imagePrompt, title, description, hashtags }
    │   ├── 03-generateImage.js     # Pollinations GET → background.png
    │   ├── 04-generateVoice.js     # Piper spawn → voice.wav
    │   ├── 05-generateSubtitles.js # estimator → subs.srt
    │   ├── 06-assembleVideo.js
    │   ├── 07-uploadYouTube.js
    │   └── 08-postFacebook.js
    └── utils/
        ├── logger.js
        ├── retry.js          # generic retry with exponential backoff (3 attempts default)
        ├── ffprobe.js        # get audio duration
        └── cleanup.js        # delete output/<runId> folders older than N days
```

---

## 4. Environment Variables (`.env.example`)

```env
# ── General ──────────────────────────────
NODE_ENV=production
CRON_SCHEDULE=0 */4 * * *        # every 4 hours (stays under YouTube's ~6/day unaudited quota)
MONGO_URI=mongodb://127.0.0.1:27017/sports_automation
OUTPUT_RETENTION_DAYS=3
DRY_RUN=false                    # true = do everything EXCEPT upload/post

# ── RSS ──────────────────────────────────
RSS_FEEDS=https://www.espn.com/espn/rss/soccer/news,https://feeds.bbci.co.uk/sport/football/rss.xml,https://www.skysports.com/rss/12040

# ── Ollama (local LLM) ───────────────────
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT_MS=120000         # local inference can be slow on CPU

# ── Pollinations (image gen, no key) ─────
POLLINATIONS_BASE_URL=https://image.pollinations.ai/prompt
IMAGE_WIDTH=768
IMAGE_HEIGHT=1344

# ── Piper (local TTS) ────────────────────
PIPER_BIN=./assets/piper/piper   # piper.exe on Windows
PIPER_VOICE=./assets/piper/en_US-ryan-high.onnx
PIPER_LENGTH_SCALE=1.0           # >1.0 slower speech, <1.0 faster

# ── YouTube ──────────────────────────────
YT_CLIENT_ID=
YT_CLIENT_SECRET=
YT_REDIRECT_URI=http://localhost:8089/oauth2callback
YT_PRIVACY_STATUS=public         # note: unaudited API projects may force private

# ── Facebook ─────────────────────────────
FB_PAGE_ID=
FB_PAGE_ACCESS_TOKEN=            # long-lived Page token with pages_manage_posts, pages_read_engagement
```

`src/config.js` must validate all required vars at startup and exit with a readable list of what's missing. `DRY_RUN=true` must short-circuit steps 07 and 08 (log "DRY RUN — skipped upload").

---

## 5. Step-by-Step Implementation Detail

### Orchestrator — `src/pipeline/run.js`
- Generate `runId` = timestamp + short random suffix. Create `output/<runId>/`.
- Create a `Run` document with `status: "running"`.
- Execute steps 01→08 sequentially. After each step, push `{ step, ok, durationMs, meta }` into `Run.stepResults`.
- **Concurrency lock:** if a previous run is still `running`, skip this tick (log a warning). Local LLM + CPU encoding can take several minutes, so this matters more in the free stack. Use an in-process boolean + a DB check; at startup mark stale `running` runs older than 45 min as `failed`.
- Any step throwing after retries → mark Run `failed`, mark the Article back to `pending` **only if** no upload happened yet (never re-post a video that already uploaded).
- Wrap the whole run in try/catch — the cron loop must NEVER crash the process.

### Step 01 — Fetch News
- Parse all feeds in `RSS_FEEDS` with `rss-parser` (tolerate individual feed failures — a dead feed must not kill the run).
- Normalize items: `{ url, title, source, publishedAt, snippet }`.
- Upsert into `Article` collection (`url` unique index) with `status: "pending"` for new ones.
- Select the newest `pending` article. If none → end run gracefully with status `"no_new_content"`.
- Set selected article `status: "processing"`.

### Step 02 — Generate Content (Ollama)
- `POST {OLLAMA_BASE_URL}/api/chat` with `stream: false` and **`format: "json"`** (this forces Ollama to emit valid JSON — critical for reliability with small local models).
- Request body shape:
  ```json
  {
    "model": "<env>",
    "stream": false,
    "format": "json",
    "options": { "temperature": 0.7 },
    "messages": [
      { "role": "system", "content": "<system prompt below>" },
      { "role": "user", "content": "<title + snippet + source>" }
    ]
  }
  ```
- System prompt requirements:
  - Voiceover script: 90–110 words, conversational spoken tone, no headlines, no "In a recent article...", hooks the viewer in the first sentence.
  - Image prompt: **must NOT name or describe any real, identifiable person** (publicity-rights safety) and no team crests/logos. Generic scenes only, e.g. "a footballer in a red kit celebrating under stadium floodlights, cinematic lighting, vertical composition".
  - Title: max 90 chars, ends with `#Shorts`.
  - Description: 2–3 sentences + 5–8 hashtags.
  - Output exactly this JSON shape: `{ "script": "", "imagePrompt": "", "title": "", "description": "", "hashtags": [] }`.
- **Defensive handling (small local models are sloppy):**
  1. `JSON.parse` in try/catch (strip ``` fences first if present, even with format:"json").
  2. Validate every field exists, script word count is 60–140, title ≤ 100 chars. 
  3. On any failure → one corrective retry ("Your last output was invalid because: <reason>. Respond with ONLY the JSON.").
  4. On second failure → **fallback template**: script = trimmed snippet rewritten by simple truncation to ~100 words, imagePrompt = fixed generic football prompt, title = article title truncated + " #Shorts". The run must still succeed.
- **Person-name post-check:** extract capitalized word pairs from the article title (simple heuristic for names); if any appear in `imagePrompt`, replace `imagePrompt` with the fixed generic template.
- Save result to `output/<runId>/content.json`.

### Step 03 — Generate Image (Pollinations)
- Build URL: `${POLLINATIONS_BASE_URL}/${encodeURIComponent(imagePrompt)}?width=${IMAGE_WIDTH}&height=${IMAGE_HEIGHT}&nologo=true&seed=${randomInt}`.
- Plain `fetch` GET → the response body IS the image. Save to `output/<runId>/background.png`.
- Set a 90s timeout (free service, can be slow). Retry via `utils/retry.js` with a NEW random seed each attempt.
- Validate: response `content-type` starts with `image/` and file size > 20 KB (Pollinations sometimes returns tiny error images). If validation fails after retries → fallback: solid dark-gradient background generated with ffmpeg (`color=` source + `gradients`), so the run still succeeds.
- Note in README: Pollinations is a free community service with no SLA — the ffmpeg-gradient fallback is the safety net.

### Step 04 — Generate Voice (Piper)
- Spawn Piper: `spawn(PIPER_BIN, ["--model", PIPER_VOICE, "--length-scale", PIPER_LENGTH_SCALE, "--output_file", "output/<runId>/voice.wav"])`, write the script text to stdin, close stdin, await exit code 0.
- Capture stderr; include it in the error message on non-zero exit.
- Use `utils/ffprobe.js` to get duration; store in run meta. If duration > 57s, re-run Piper once with `length-scale` reduced by 10% (speaks faster); if still long, step 06 trims.
- Output is WAV — ffmpeg consumes it directly, no conversion needed.

### Step 05 — Generate Subtitles (estimator)
- Split script into caption chunks of ≤ 5 words (break at punctuation where possible).
- Distribute timing proportionally to word count across the measured audio duration, with 0.05s gaps between cues.
- Output `output/<runId>/subs.srt`.
- Keep the module pluggable behind a `SUBTITLE_PROVIDER` switch so a local `faster-whisper` provider can be added later, but only implement `estimate` now.

### Step 06 — Assemble Video (FFmpeg)
- Canvas 1080x1920, 30fps, H.264 (`libx264`, preset `medium`) + AAC, duration = min(audio duration + 0.5s, 59s).
- Filters:
  - Scale/crop `background.png` to fill 1080x1920.
  - Ken Burns: `zoompan` slow zoom-in (zoom 1.0 → 1.12 over the full duration).
  - Pick a random `.mp3` from `assets/music/` (if folder empty, skip music gracefully).
  - Mix: voice at 1.0, music at ~0.15 (`amix` + `volume`), fade music out last 1s.
  - Burn subtitles: `subtitles=subs.srt:force_style='FontSize=16,Bold=1,Alignment=2,MarginV=60,OutlineColour=&H80000000,BorderStyle=3'`.
- Use `fluent-ffmpeg`; log the full ffmpeg command; on failure include stderr in the error.
- Output: `output/<runId>/final.mp4`. Verify file exists and is > 100 KB before proceeding.
- CPU encoding of ~50s at 1080x1920 takes roughly 1–3 min on a typical desktop — acceptable; do not parallelize.

### Step 07 — Upload to YouTube
- `googleapis` OAuth2 client using `YT_CLIENT_ID/SECRET` + refresh token from `tokens/youtube_token.json`.
- `youtube.videos.insert` with `part: snippet,status`, categoryId 17 (Sports), `privacyStatus` from env, title/description/hashtags from content.json (append `#Shorts` to description too).
- `scripts/youtube-auth.js`: standalone script that prints the consent URL, runs a tiny local server on the redirect port, exchanges the code, writes `tokens/youtube_token.json`. This is a one-time manual step.
- Handle `quotaExceeded` distinctly: mark run failed with reason `youtube_quota`, do NOT retry (retrying burns quota).
- Save returned video ID to the Run doc.

### Step 08 — Post Facebook Reel
- Graph API Reels flow on the Page:
  1. `POST /{page-id}/video_reels` with `upload_phase=start` → get `video_id` + upload URL
  2. Upload the binary
  3. `POST /{page-id}/video_reels` with `upload_phase=finish`, `video_state=PUBLISHED`, description
- Put the Graph API version in a single constant; note in README to check Meta docs for the current version.
- If Facebook fails but YouTube succeeded, mark run `partial_success` — do not fail the whole run.

### Startup & Cleanup
- `scripts/check-deps.js` (also invoked from `index.js` at boot): ffmpeg `-version`, `GET {OLLAMA_BASE_URL}/api/tags` (verify configured model is pulled), Piper binary + voice file exist, Mongo ping. Exit with a specific install hint for whichever check fails.
- `utils/cleanup.js` runs once per day (separate cron): delete `output/<runId>` folders older than `OUTPUT_RETENTION_DAYS`.
- `index.js`: validate config → dep checks → connect Mongo → recover stale runs → register crons → log "scheduler armed". Handle SIGINT/SIGTERM gracefully.

---

## 6. PM2 — `ecosystem.config.cjs`

```js
module.exports = {
  apps: [{
    name: "sports-automation",
    script: "src/index.js",
    autorestart: true,
    max_memory_restart: "600M",
    env: { NODE_ENV: "production" },
    out_file: "logs/pm2-out.log",
    error_file: "logs/pm2-err.log",
    time: true
  }]
};
```

README must include: `pm2 start ecosystem.config.cjs`, `pm2 save`, `pm2 startup` (survives PC reboots). Note: Ollama runs as its own service/app — PM2 manages only the Node pipeline.

---

## 7. Rules & Constraints (do not violate)

1. **Never hardcode secrets, URLs, model names, or binary paths** — everything from env.
2. **Never process the same article URL twice** — unique index enforced in Mongo.
3. **Never re-upload on retry** — retries happen at step level; a run that completed step 07 must never roll the article back to `pending`.
4. **Image prompts must never reference real identifiable people or club logos** — enforced in the LLM system prompt AND the person-name post-check in step 02.
5. **Total video length ≤ 59 seconds.**
6. **Every generative step has a free fallback** (LLM → template, image → ffmpeg gradient) so a run never dies because a free service hiccuped.
7. **The process must never crash from a failed run** — cron tick is fully sandboxed.
8. Keep every module under ~150 lines; single responsibility per file.
9. Minimal real tests only for pure logic (subtitle chunking/timing, config validation, content-JSON validator, person-name heuristic) using Node's built-in `node:test`.

---

## 8. Build Phases (work in this order)

**Phase 1 — Skeleton:** package.json, config.js with validation, logger, DB connect + models, `scripts/check-deps.js`, index.js with cron wiring, PM2 config, .env.example, .gitignore. Verify: app starts, dep checks report clearly, logs "scheduler armed", exits cleanly on Ctrl+C.

**Phase 2 — Content pipeline (no media):** steps 01 + 02 (including JSON validation, corrective retry, fallback template, person-name post-check), orchestrator with Run tracking, `scripts/test-run.js`. Verify: test run fetches feeds, dedupes, produces valid `content.json` against the real local Ollama.

**Phase 3 — Media:** steps 03 (with gradient fallback), 04, 05, 06 + ffprobe util. Verify: test run produces a playable `final.mp4` with audio and burned subtitles.

**Phase 4 — Publishing:** steps 07 + 08, `scripts/youtube-auth.js`, DRY_RUN gate, quota handling, partial_success logic.

**Phase 5 — Hardening:** cleanup cron, stale-run recovery, retry polish, unit tests, then generate README.md with full setup instructions: installing Ollama + pulling the model, downloading Piper + a voice, ffmpeg, MongoDB, creating the Google Cloud project for YouTube API, and getting the Facebook Page token.

After each phase, run `node scripts/test-run.js` (with DRY_RUN=true where relevant) and fix issues before moving on.

---

## 9. Known Caveats of the Free Stack (document in README, don't try to "solve" in code)

- **Ollama on CPU is slow** — a content-generation call can take 30–120s on an 8B model without a GPU. Fine for an hourly job; that's why the timeout is 120s and the concurrency lock exists.
- **Small local models are less reliable at JSON/creative quality** than hosted frontier models — hence `format:"json"`, validation, corrective retry, and fallback template.
- **Pollinations has no SLA** — free community service; the gradient fallback covers outages.
- **Piper voices sound flatter than ElevenLabs** — acceptable, and `length-scale` tuning helps pacing.
- **YouTube:** unaudited API projects get low upload quota (~6/day) and uploads may be forced private until the project passes Google's audit — this is why the default cron is every 4 hours, not hourly.
- **YouTube policy is hostile to mass-produced faceless AI content** — monetization is not guaranteed; stock-style visuals and good scripts reduce risk.
- **Facebook Reels publishing** requires a Page (not a profile) and an app with the right permissions.
- Total recurring cost: **$0**. Electricity is the only bill.
