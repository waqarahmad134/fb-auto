# Football Shorts Automation Pipeline (Zero-Cost Edition)

A Node.js service that runs 24/7 and, every few hours, automatically pulls a football
news story, writes a script for it with a local LLM, generates a background image and
voiceover, assembles a vertical Short with a burned-in headline graphic and subtitles,
and publishes it to a Facebook Page as a Reel. See [SPORTS_AUTOMATION_SPEC.md](SPORTS_AUTOMATION_SPEC.md)
for the full design spec this project was built from (note: the spec's YouTube upload
step was later removed — see [PROJECT_STATUS.md](PROJECT_STATUS.md)).

> Picking this up on a new machine? Read [PROJECT_STATUS.md](PROJECT_STATUS.md) first —
> it covers what's already built, what's still not installed, and where to start.

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

### Storage
No database to install. Articles and run history are stored as plain JSON files
under `DATA_DIR` (default `./data/articles.json` and `./data/runs.json`) — the
directory is created automatically on first run.

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
each failing check (ffmpeg, Ollama/model, Piper binary+voice, local data directory).

### Environment variables

All variables are documented with inline comments in [.env.example](.env.example).
Key ones:

- `DRY_RUN=true` — runs the entire pipeline (news → script → image → voice →
  subtitles → video) but **skips** the Facebook post step. Use this while testing
  so you don't need a real Page token yet.
- `CRON_SCHEDULE` — defaults to every 4 hours.
- `RSS_FEEDS` — comma-separated list of RSS feed URLs.

`src/config.js` validates all required variables at startup and exits with a clear
list of what's missing if anything is unset. `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN` are
**not** in that required list — if either is blank, the Facebook step just skips
itself at runtime (logs a warning) instead of failing the run, so you can run the
whole pipeline and inspect the generated video before ever setting up a Page token.

---

## 3. Getting a Facebook Page access token

1. You need a Facebook **Page** (not a personal profile) to publish Reels to.
2. Create an app at https://developers.facebook.com/apps/ and add the **Facebook
   Login** and **Pages API** products.
3. Request the `pages_manage_posts` and `pages_read_engagement` permissions for the
   Page you own.
4. Generate a long-lived Page access token (Graph API Explorer → get a User token
   with those permissions → exchange it for a long-lived token → exchange that for
   a Page token). See Meta's Page Access Token docs for the exact exchange calls.
   **Both parts matter and are easy to get wrong**: in Graph API Explorer, the
   "User or Page" dropdown must be switched to **Page Token** (not left on User
   Token — those are different tokens with different permissions), and
   `pages_manage_posts` specifically must be in the permission list — verified live
   that a token missing either of these fails with a Graph API error
   ("does not exist, cannot be loaded due to missing permissions") the moment you
   try to actually post, even though the token looks valid for read-only calls.
5. Put the Page ID in `FB_PAGE_ID` and the long-lived Page token in
   `FB_PAGE_ACCESS_TOKEN`.
6. Check the current Graph API version at https://developers.facebook.com/docs/graph-api/changelog
   and update the constant in `src/config.js` (`facebook.graphApiVersion`) if it has
   been deprecated.

---

## 4. Running it

### One-off test run (no cron, runs immediately)
```
npm run test-run
```
This runs dependency checks and executes the pipeline exactly once — useful after
each setup step to confirm things work before trusting the scheduler.

### Admin dashboard
```
npm run admin
```
Starts just the local web dashboard at `http://localhost:4321` — run history with
per-step status, a "Run Now" trigger, the article queue, a preview of each run's
generated script/image/video, per-run Stop/Continue, and a manual "Upload" button
in the Facebook column for any run that has a video but hasn't been posted yet
(e.g. one that finished before Facebook credentials were configured). This only
needs the local data directory (no ffmpeg/Ollama/Piper required), so it's useful
for browsing state while the rest of setup is still in progress. When running the
full app (`npm start` / PM2), the same dashboard is served automatically on the
same port.

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

---

## 5. How it works

Every tick of `CRON_SCHEDULE`, the pipeline (`src/pipeline/run.js`) runs these steps
in order, recording each step's result to a run record in `data/runs.json`:

1. **Fetch news** — pull all configured RSS feeds, upsert new articles, pick the
   newest unprocessed one. Dead feeds are skipped, not fatal.
2. **Generate content** — one structured JSON call to a local Ollama model, acting as
   a sports graphic designer/editor: voiceover script, an original silhouette-framed
   image prompt, a short on-screen `posterHeadline` + `posterSubtext`, title,
   description, hashtags. The model is instructed to treat the RSS title/snippet as
   its only verified facts (no inventing scores/quotes), to phrase things as a
   "developing story" when the snippet doesn't state a result, and to never describe
   real broadcaster branding/logos/watermarks. Includes a corrective retry and a
   guaranteed template fallback if the local model produces invalid output twice,
   plus a person-name heuristic that strips any real name out of the image prompt.
3. **Generate image** — three tiers, in order: (1) the real photo from the article
   — the RSS feed's embedded image, then the article page's `og:image` tag, only if
   `USE_ARTICLE_IMAGE=true` (default **false** — see the copyright note in
   [Known caveats](#8-known-caveats-of-the-free-stack)); real-photo candidates are
   rejected if they have a baked-in letterbox/border band (`src/utils/letterbox.js`)
   — the signature of a branded social-share card template rather than a neutral
   photo — falling through to the next tier instead; (2) an AI-generated image
   via Pollinations.ai (free, no API key) using the LLM's silhouette-framed prompt;
   (3) an ffmpeg-generated gradient background if both of the above fail.
4. **Generate voice** — Piper TTS, fully offline.
5. **Generate subtitles** — a zero-dependency word-timing estimator that splits the
   script into short cues and times them proportionally against the measured audio
   duration.
6. **Assemble video** — FFmpeg composites a 1080x1920 Short in a framed layout:
   solid black bars top (`TOP_BAR_HEIGHT`) and bottom (`BOTTOM_BAR_HEIGHT` in
   `06-assembleVideo.js`), like a poster/thumbnail template — the photo sits in the
   shrunk middle region only, so **no text ever overlaps the image**. A slow Ken
   Burns zoom (1.0→1.12x) on that photo is centered on any detected face — or the
   midpoint of a group of faces — so it's never cropped or zoomed out of frame as
   the shot tightens; falls back to a plain center-zoom if no face is found or face
   detection fails for any reason (`@tensorflow-models/blazeface`, pure JS/CPU, no
   native compilation or internet dependency beyond its one-time model fetch — see
   [Known caveats](#8-known-caveats-of-the-free-stack)). An original
   headline/subtext graphic lives in the top bar, burned in with the `Anton` font
   (`assets/fonts/`, bundled) — via a text file, not inline `text=`, to sidestep
   ffmpeg's fragile drawtext quoting for apostrophes in real headlines — wrapped at
   a per-line character count tuned against the *actual measured pixel width* of
   real headlines rendered in this exact font/size (not a visual guess — a short
   headline that easily fits on one line was wrapping to two before this), and
   capped at 2 lines (`src/utils/textWrap.js`'s `truncateToMaxLines`, ellipsis on
   overflow) for the genuinely long ones.
   Subtitles live in the bottom bar (`PlayResX`/`PlayResY` set explicitly in
   `force_style` — without them libass silently mis-scales `MarginV` against the
   wrong reference resolution and the subtitles land back over the image).
   Voiceover mixed with ducked background music (from `assets/music/`, optional).
7. **Post to Facebook** as a Page Reel — the only publish target; there is no
   YouTube upload step. If `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN` aren't set, this step
   skips itself (logs a warning) instead of failing the run, same as `DRY_RUN=true`.

A run never re-processes the same article URL twice (deduplicated by URL in
`data/articles.json`), and an article is only rolled back to `pending` on failure if
no post has happened yet — once the Facebook post succeeds, the article is never
reprocessed.

A concurrency lock (in-process + a check for any run still marked `running`) skips a
tick entirely if the previous run is still going; stale `running` runs older than 45
minutes are marked `failed` at startup so a crashed process doesn't permanently
block future ticks.

A separate daily cron (`src/utils/cleanup.js`) deletes `output/<runId>` folders older
than `OUTPUT_RETENTION_DAYS`.

---

## 6. Adding background music (optional)

Drop any royalty-free `.mp3` files into `assets/music/`. One is picked at random for
each video and mixed under the voiceover at low volume with a fade-out. If the
folder is empty, videos are produced without music — this is not an error.

---

## 7. Running tests

```
npm test
```

Runs Node's built-in test runner (`node:test`) against the pure logic modules:
subtitle chunking/timing, config validation, content-JSON validation, and the
person-name heuristic. These don't require Ollama, Piper, or ffmpeg to be running.

---

## 8. Known caveats of the free stack

- **Ollama on CPU is slow.** A content-generation call can take 30–120 seconds on an
  8B model without a GPU — expected, and why the timeout is 120s and there's a
  concurrency lock.
- **Small local models are less reliable at JSON/creative quality** than hosted
  frontier models. That's why step 02 uses `format: "json"`, strict validation, one
  corrective retry, and a guaranteed fallback template — a run should never fail
  outright just because the model produced something malformed.
- **Small local models can still hallucinate names not in the source article** (seen
  live: a model invented an uninvolved real player's name and wrote it straight into
  the image prompt). The person-name safety net catches names written into the
  image prompt itself (not just names echoed from the title), but it can't catch
  every case — a surname the safe-word list doesn't recognize as a place/generic
  term could still slip through occasionally.
- **Face detection (`@tensorflow-models/blazeface`) fetches its model from
  `tfhub.dev` the first time it runs** in a given process, then keeps it in memory
  for every run after that — so only the very first video after a (re)start needs
  that one network call. If it's unreachable, or detection fails for any other
  reason, the run doesn't fail — it just falls back to a plain center-framed zoom.
- **`USE_ARTICLE_IMAGE=true` carries real copyright/publicity-rights risk — default is `false`.**
  The real photo pulled from an RSS feed or article page is often not a neutral news
  photo — it's frequently a network-branded editorial graphic (e.g. a BBC Sport promo
  graphic with their logo baked in and a named real person as the subject).
  Republishing that on your own Facebook channel is republishing someone else's
  copyrighted, branded asset, not a generic photo. There's no automated filter for
  this. The default AI-generated silhouette image avoids the problem entirely; only
  flip this on if you've weighed the risk yourself.
- **Pollinations.ai has no SLA.** It's a free community service; the
  ffmpeg-gradient fallback exists specifically to cover outages.
- **Piper voices sound flatter than commercial TTS** (e.g. ElevenLabs). Acceptable
  for this use case; `PIPER_LENGTH_SCALE` lets you tune pacing.
- **Faceless, mass-produced AI content can draw scrutiny on any platform**, not just
  a specific one. Better scripts and less generic visuals reduce risk, but this
  isn't something the code can fix for you.
- **Storage is plain JSON files, not a database.** Simple and zero-install, but
  `data/articles.json` grows forever as RSS feeds are polled — fine for personal-scale
  use over months, but prune it manually if it gets unwieldy after a long time.
- **Facebook Reels publishing requires a Page**, not a personal profile, and an app
  with the right permissions approved.

---

## 9. Project structure

```
sports-automation/
├── assets/music/        # drop royalty-free .mp3 files here
├── assets/piper/        # piper binary + voice model (gitignored)
├── assets/fonts/        # Anton font for the headline/subtext overlay (bundled)
├── data/                 # articles.json + runs.json local storage (gitignored)
├── output/<runId>/      # generated artifacts per run (gitignored)
├── logs/                # pino app logs + PM2 logs (gitignored)
├── scripts/
│   ├── check-deps.js    # verifies ffmpeg, Ollama, Piper, local data dir
│   ├── test-run.js      # runs the pipeline once, immediately
│   └── admin-only.js    # starts just the dashboard, no cron/dep checks
├── src/
│   ├── index.js         # entry point: validate → dep check → connect → cron
│   ├── config.js         # env loading + validation
│   ├── db/               # local JSON file store (articleStore.js, runStore.js)
│   ├── admin/             # Express dashboard (server.js + public/ frontend)
│   ├── pipeline/          # steps 01–06 + 08 + the run.js orchestrator (no step 07),
│   │                      # face-detect.js (blazeface)
│   └── utils/             # logger, retry, ffprobe, cleanup, cancellation, textWrap,
│                          # faceZoom (pure geometry for face-centered zoom)
└── tests/                 # node:test unit tests for pure logic
```
