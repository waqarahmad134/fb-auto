# Football Shorts Automation Pipeline (Zero-Cost Edition)

A Node.js service that runs 24/7 and, every few hours, automatically pulls a football
news story, writes a script for it with a local LLM, generates a background image and
voiceover, assembles a vertical Short with burned-in subtitles, and publishes it to
YouTube Shorts and a Facebook Page as a Reel. See [SPORTS_AUTOMATION_SPEC.md](SPORTS_AUTOMATION_SPEC.md)
for the full design spec this project was built from.

Recurring cost: **$0**. Only electricity.

---

## 1. One-time local installs

### Node.js 20+
Already required to run this project. Verify with `node --version`.

### Ollama (local LLM)
1. Install from https://ollama.com
2. Pull a model:
   ```
   ollama pull llama3.1:8b
   ```
   Needs ~8 GB RAM. If your machine has less, use a smaller model instead and set
   `OLLAMA_MODEL` accordingly:
   ```
   ollama pull llama3.2:3b
   # or
   ollama pull phi3:mini
   ```
3. Ollama runs as its own background service — this project only calls its REST API
   at `http://localhost:11434`. It is **not** managed by PM2.

### Piper (local TTS)
1. Download the Piper release binary for your OS from the Piper releases page
   (search "rhasspy piper releases" — the project moves between orgs occasionally).
2. Download one voice, e.g. `en_US-ryan-high.onnx` **and** its matching
   `en_US-ryan-high.onnx.json` config file, from the Piper voices repo.
3. Put all three files in `assets/piper/`:
   ```
   assets/piper/piper(.exe)
   assets/piper/en_US-ryan-high.onnx
   assets/piper/en_US-ryan-high.onnx.json
   ```
4. Point `PIPER_BIN` and `PIPER_VOICE` in `.env` at these paths.

### FFmpeg
Install FFmpeg and make sure it's on your `PATH`. Verify with `ffmpeg -version`.
Windows builds: https://www.gyan.dev/ffmpeg/builds/ (the "essentials" build is enough).

### Database — nothing to install
State is stored in an embedded **SQLite** database (via `better-sqlite3`), created
automatically at `DB_PATH` (default `./data/app.db`) on first run. There is no
database server to install, start, or keep running — it's just a file. `npm install`
compiles/downloads the `better-sqlite3` binary for your platform.

---

## 2. Project setup

```
npm install
copy .env.example .env      # (or `cp` on macOS/Linux)
```

Edit `.env` and fill in the values described below. Then verify every dependency is
reachable:

```
npm run check-deps
```

Fix anything it reports before continuing — it prints a specific install hint for
each failing check (ffmpeg, Ollama/model, Piper binary+voice). The database needs
no check — SQLite is embedded and its file is created on first connect.

### Environment variables

All variables are documented with inline comments in [.env.example](.env.example).
Key ones:

- `DRY_RUN=true` — runs the entire pipeline (news → script → image → voice →
  subtitles → video) but **skips** the YouTube upload and Facebook post steps. Use
  this while testing so you don't need real API credentials yet.
- `CRON_SCHEDULE` — defaults to every 4 hours, to stay under YouTube's low unaudited
  upload quota (see [Known caveats](#5-known-caveats-of-the-free-stack)).
- `RSS_FEEDS` — comma-separated list of RSS feed URLs.

`src/config.js` validates all required variables at startup and exits with a clear
list of what's missing if anything is unset (publish-related variables are only
required when `DRY_RUN=false`).

---

## 3. Getting YouTube API credentials

1. Go to https://console.cloud.google.com/ and create a new project.
2. Enable the **YouTube Data API v3** for that project.
3. Configure the OAuth consent screen (External, testing mode is fine).
4. Create OAuth 2.0 credentials of type **Desktop app** (or Web app with the redirect
   URI below) — copy the Client ID and Client Secret into `.env` as `YT_CLIENT_ID`
   and `YT_CLIENT_SECRET`.
5. Set `YT_REDIRECT_URI` in `.env` (default `http://localhost:8089/oauth2callback`)
   and add the same URI to the credential's authorized redirect URIs in the Cloud
   Console.
6. Run the one-time interactive auth flow:
   ```
   npm run youtube-auth
   ```
   This opens a consent URL for you to approve in a browser, then saves a refresh
   token to `tokens/youtube_token.json`. This file is gitignored — back it up
   somewhere safe, since deleting it means re-running this step.

**Note:** unaudited API projects get a low daily upload quota (roughly 6/day) and
may force uploads to `private` until the project passes Google's audit. This is
part of why the default schedule is every 4 hours, not hourly.

---

## 4. Getting a Facebook Page access token

1. You need a Facebook **Page** (not a personal profile) to publish Reels to.
2. Create an app at https://developers.facebook.com/apps/ and add the **Facebook
   Login** and **Pages API** products.
3. Request the `pages_manage_posts` and `pages_read_engagement` permissions for the
   Page you own.
4. Generate a long-lived Page access token (Graph API Explorer → get a User token
   with those permissions → exchange it for a long-lived token → exchange that for
   a Page token). See Meta's Page Access Token docs for the exact exchange calls.
5. Put the Page ID in `FB_PAGE_ID` and the long-lived Page token in
   `FB_PAGE_ACCESS_TOKEN`.
6. Check the current Graph API version at https://developers.facebook.com/docs/graph-api/changelog
   and update the constant in `src/config.js` (`facebook.graphApiVersion`) if it has
   been deprecated.

---

## 5. Running it

### One-off test run (no cron, runs immediately)
```
npm run test-run
```
This runs dependency checks, opens the SQLite database, and executes the pipeline
exactly once — useful after each setup step to confirm things work before trusting
the scheduler.

### 24/7 with PM2
```
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup     # follow the printed instructions so PM2 survives a reboot
```

Logs go to `logs/pm2-out.log` / `logs/pm2-err.log` (PM2) and `logs/app.log`
(structured JSON app logs via pino). PM2 manages only the Node process — Ollama
runs as its own separate service and is not restarted by PM2.

### Stopping
```
pm2 stop sports-automation
```

### Admin dashboard
A small local web dashboard starts automatically alongside the scheduler on
`ADMIN_PORT` (default `4321`) — open `http://localhost:4321`. It shows run
counts by status and the number of pending articles, a table of recent runs
(each expandable to a per-step breakdown plus links to that run's generated
artifacts — `background.png`, `voice.wav`, `subs.srt`, `final.mp4`,
`content.json`), and the article queue. A **Run Now** button triggers the
pipeline on demand without waiting for the next cron tick.

To browse run history and the article queue **without** starting the scheduler
or running the ffmpeg/Ollama/Piper dependency checks (useful while the rest of
the stack is still being set up), start just the dashboard:
```
npm run admin
```
This opens the SQLite database and serves the dashboard only — no cron, no video
generation. The media artifacts are served straight from `output/<runId>/`, so
they're only viewable until the daily cleanup cron deletes that run's folder.

---

## 6. How it works

Every tick of `CRON_SCHEDULE`, the pipeline (`src/pipeline/run.js`) runs these steps
in order, recording each step's result on a `run` row in SQLite:

1. **Fetch news** — pull all configured RSS feeds, upsert new articles, pick the
   newest unprocessed one. Dead feeds are skipped, not fatal.
2. **Generate content** — one structured JSON call to a local Ollama model:
   voiceover script, image prompt, title, description, hashtags. Includes a
   corrective retry and a guaranteed template fallback if the local model produces
   invalid output twice, plus a person-name heuristic that strips any real name
   out of the image prompt.
3. **Generate image** — Pollinations.ai (free, no API key). Falls back to an
   ffmpeg-generated gradient background if Pollinations is down or returns junk.
4. **Generate voice** — Piper TTS, fully offline.
5. **Generate subtitles** — a zero-dependency word-timing estimator that splits the
   script into short cues and times them proportionally against the measured audio
   duration.
6. **Assemble video** — FFmpeg composites a 1080x1920 Short: Ken Burns zoom on the
   background image, voiceover mixed with ducked background music (from
   `assets/music/`, optional), burned-in subtitles.
7. **Upload to YouTube** as a Short.
8. **Post to Facebook** as a Page Reel. If this step fails after YouTube already
   succeeded, the run is marked `partial_success` rather than `failed` — the video
   already went out on YouTube and must never be re-posted there on retry.

A run never re-processes the same article URL twice (the `url` primary key in
SQLite enforces this), and
an article is only rolled back to `pending` on failure if no upload has happened yet
— once step 07 succeeds, the article is never reprocessed, even if step 08 fails.

A concurrency lock (in-process + DB check) skips a tick entirely if the previous run
is still going; stale `running` runs older than 45 minutes are marked `failed` at
startup so a crashed process doesn't permanently block future ticks.

A separate daily cron (`src/utils/cleanup.js`) deletes `output/<runId>` folders older
than `OUTPUT_RETENTION_DAYS`.

---

## 7. Adding background music (optional)

Drop any royalty-free `.mp3` files into `assets/music/`. One is picked at random for
each video and mixed under the voiceover at low volume with a fade-out. If the
folder is empty, videos are produced without music — this is not an error.

---

## 8. Running tests

```
npm test
```

Runs Node's built-in test runner (`node:test`) against the pure logic modules:
subtitle chunking/timing, config validation, content-JSON validation, and the
person-name heuristic. These don't require Ollama, Piper, ffmpeg, or any database
to be running.

---

## 9. Known caveats of the free stack

- **Ollama on CPU is slow.** A content-generation call can take 30–120 seconds on an
  8B model without a GPU — expected, and why the timeout is 120s and there's a
  concurrency lock.
- **Small local models are less reliable at JSON/creative quality** than hosted
  frontier models. That's why step 02 uses `format: "json"`, strict validation, one
  corrective retry, and a guaranteed fallback template — a run should never fail
  outright just because the model produced something malformed.
- **Pollinations.ai has no SLA.** It's a free community service; the
  ffmpeg-gradient fallback exists specifically to cover outages.
- **Piper voices sound flatter than commercial TTS** (e.g. ElevenLabs). Acceptable
  for this use case; `PIPER_LENGTH_SCALE` lets you tune pacing.
- **YouTube's unaudited API quota is low** (~6 uploads/day) and uploads may be
  forced `private` until the project passes Google's audit — this is why the
  default schedule is every 4 hours, not hourly.
- **YouTube policy is hostile to mass-produced faceless AI content.** Monetization
  isn't guaranteed. Better scripts and less generic visuals reduce risk, but this
  isn't something the code can fix for you.
- **Facebook Reels publishing requires a Page**, not a personal profile, and an app
  with the right permissions approved.

---

## 10. Project structure

```
sports-automation/
├── assets/music/        # drop royalty-free .mp3 files here
├── assets/piper/        # piper binary + voice model (gitignored)
├── data/                # SQLite database file (app.db, gitignored)
├── output/<runId>/      # generated artifacts per run (gitignored)
├── logs/                # pino app logs + PM2 logs (gitignored)
├── tokens/               # youtube_token.json (gitignored)
├── scripts/
│   ├── check-deps.js    # verifies ffmpeg, Ollama, Piper
│   ├── test-run.js      # runs the pipeline once, immediately
│   ├── youtube-auth.js  # one-time OAuth flow for the YouTube refresh token
│   └── admin-only.js    # starts just the admin dashboard (no cron/dep checks)
├── src/
│   ├── index.js         # entry point: validate → dep check → connect → cron → admin
│   ├── config.js         # env loading + validation
│   ├── config-validation.js  # required-var rules (shared by config + tests)
│   ├── admin/            # local web dashboard (Express server + static UI)
│   ├── db/               # SQLite connection + articles/runs data access
│   ├── pipeline/          # steps 01–08 + the run.js orchestrator
│   └── utils/             # logger, retry, ffprobe, cleanup
└── tests/                 # node:test unit tests for pure logic
```
