# Project Status — Football Shorts Automation Pipeline

> Read this first if you're picking up this project on a different machine. For setup
> steps see [README.md](README.md); for the original design spec see
> [SPORTS_AUTOMATION_SPEC.md](SPORTS_AUTOMATION_SPEC.md) — note the spec calls for
> MongoDB, but storage was deliberately changed to plain local JSON files (see
> "Deviation from spec" below).

## What this is

A Node.js service that runs 24/7 and, on a schedule, automatically turns one football
news story into a vertical Short (script → image → voiceover → subtitles → assembled
video) and publishes it to a Facebook Page as a Reel. Built entirely on free/local
tools (Ollama, Pollinations.ai, Piper TTS, FFmpeg) — no recurring cost, no database
to install. There is no YouTube upload step — see "Deviation from spec: YouTube
upload removed" below.

Repo: https://github.com/waqarahmad134/fb-auto — project lives in the
`sports-automation/` subfolder.

## Build status: code-complete and verified

All 5 spec phases plus an admin dashboard are implemented:

| Area | Status | Notes |
|---|---|---|
| Skeleton (config, storage, cron, dep checks) | ✅ done | |
| Content pipeline (RSS + Ollama) | ✅ done | Verified repeatedly against real local models — corrective retry + fallback template confirmed working, including a real Ollama 404 (wrong model name) correctly triggering the fallback |
| Media pipeline (image, voice, subtitles, video) | ✅ done, verified live | Piper installed and confirmed end-to-end: real RSS → real Ollama script → real image → real ~27s voiceover → real subtitles → a genuinely playable 1080x1920 H.264/AAC video, checked with ffprobe |
| Publishing (Facebook only) | ⚠️ blocked on token | `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN` configured in `.env`, but the token is a **User Token missing `pages_manage_posts`** — a real post attempt fails with a clean Graph API permissions error. See "Facebook token needs fixing" below. |
| Hardening (cleanup, retry, tests, README) | ✅ done | 55/55 unit tests passing (`npm test`) |
| Admin dashboard (`src/admin/`) | ✅ done, verified live | Stats cards, run history, run detail drawer with script/image/video preview, "Run Now" trigger, per-run Stop/Continue, and a manual "Upload to Facebook" button for any run with a video but no Facebook post yet — all confirmed working against real runs |
| Face-aware Ken Burns zoom | ✅ done, verified live | `@tensorflow-models/blazeface` detects faces in the background image; zoom centers on the face (or group midpoint) instead of the frame center. Verified by extracting start/mid/end frames from a real assembled video — face stays fully in view and centered as the shot zooms from 1.0x to 1.12x |
| Letterbox/border rejection + 2-line headline cap | ✅ done, verified live | Real BBC-branded "GOSSIP" article image (baked-in black bars + logo) correctly rejected and replaced with a clean AI image; a real 3-line-wrapping headline correctly truncated to 2 lines with an ellipsis |
| Framed layout: intentional black bars top/bottom | ✅ done, verified live | Reworked per user request (they wanted the black-bar "poster" look intentionally, not removed) — photo sits in a shrunk middle region, headline/subtext in the top bar, subtitles in the bottom bar, so text never overlaps the image. Two bugs found and fixed while verifying with real frames: headline/subtext were crowding each other (glyph height underestimated), and subtitles rendered in the middle of the frame instead of the bottom bar (libass was scaling `MarginV` against the wrong assumed reference resolution — fixed by setting `PlayResX`/`PlayResY` explicitly in `force_style`) |

Unit tests (`npm test`) cover pure logic only — subtitle chunking/timing, config
validation, content-JSON validation, person-name heuristic, og:image HTML extraction,
face-zoom geometry, letterbox-band detection, text-line-cap truncation. They don't
require any external service.

## Facebook token needs fixing before real posting works

Verified live against the real Page ID with `postRunToFacebook()`: the current
token fails with `"Object with ID '...' does not exist, cannot be loaded due to
missing permissions"` — a clean, correctly-handled error (no crash, no corrupted
run state), but it means posting doesn't actually work yet. Root cause, visible in
the user's own Graph API Explorer screenshot: the "User or Page" dropdown was left
on **User Token** (need **Page Token** instead — a different token altogether), and
`pages_manage_posts` wasn't in the selected permissions (only `pages_show_list`,
`ads_management`, `ads_read`, `business_management`, `pages_read_engagement` were).
See [README.md § 3](README.md#3-getting-a-facebook-page-access-token) for the
corrected steps — both the permission and the Page/User token switch matter.

## Feature added beyond spec: manual "Upload to Facebook" button

Requested: a way to manually trigger posting a specific already-assembled run's
video to Facebook from the dashboard, for runs that succeeded before Facebook
credentials existed (their `postFacebook` step ran but skipped, so they never
actually posted). `src/pipeline/run.js`'s `postRunToFacebook(runId)` reads that
run's existing `final.mp4` + `content.json` from disk and calls `postFacebook`
directly — no need to re-run the rest of the pipeline. Exposed as
`POST /api/runs/:runId/post-facebook`; the dashboard shows an "Upload" button
(table Facebook column + drawer) for any run with an assembled video and no
`facebookVideoId` yet, guarded by a client-side confirm dialog since it's a real
public post. Verified live against the real Page (see above) — correctly attempted
the post and correctly surfaced the permissions error without corrupting state.

## Feature added beyond spec: letterbox/border rejection + 2-line headline cap

Requested (with a screenshot): black bars at the top and bottom of a real generated
video, and the on-screen headline should be capped to 1-2 lines in a compact block
rather than growing tall enough to cover the shot.

**Root-caused, not just patched:** the black bars were not a bug in the scale/crop/
zoompan math (verified by isolating each ffmpeg filter stage on the actual file —
`scale` alone, `crop` alone — both behaved correctly). The *source image itself*
(`background.png`, 1200x675) was a real BBC Sport "GOSSIP" branded social-share
card — baked-in black letterbox bars top and bottom, a "GOSSIP" text overlay, and
the BBC Sport logo — pulled in via `USE_ARTICLE_IMAGE=true` (re-enabled at some
point after being defaulted off; see the earlier deviation entry). This is the same
branding/logo risk flagged twice before now, just manifesting as a visual defect
instead of a copyright concern.

Fix: `src/utils/letterbox.js`'s `isUniformColorBand` (pure, unit-tested) samples
the top/bottom strips of a downloaded article-image candidate and checks whether a
large majority of pixels match one dominant color — the signature of a template
border, since real photos always have texture/gradient even in dark regions (a
night sky is never perfectly flat). Uses a majority-match rather than requiring the
*entire* strip to be flat, because the actual photo content in the GOSSIP card
poked slightly into the sampled strip on one side — an early stricter version
missed it for exactly that reason, caught by testing against the real failing file.
Wired into `03-generateImage.js`'s `tryArticleImage` — a rejected image falls
through to the next tier (og:image, then Pollinations, then gradient) exactly like
any other validation failure.

Also added `truncateToMaxLines` (`src/utils/textWrap.js`, unit-tested): caps
already-wrapped text to 2 lines with an ellipsis on the last line if anything was
cut, wired into `06-assembleVideo.js`'s headline/subtext `drawTextFilter`.

## Feature added beyond spec: face-aware Ken Burns zoom

Requested: if the background image has a face, zoom in slowly without cropping it
out, keeping it centered — including centering on the group if there's more than
one face. Implemented as `src/pipeline/face-detect.js` (blazeface inference,
fail-soft — any error just falls back to a plain center zoom, never fails the run)
+ `src/utils/faceZoom.js` (pure geometry, unit-tested): computes the union bounding
box center across however many faces are found, maps that point through the same
scale-then-center-crop transform ffmpeg applies to the image, clamps it to the
canvas bounds, and feeds it into the zoompan filter's `x`/`y` expressions.

**Two library dead-ends hit and abandoned before landing on this, worth knowing
about if this needs revisiting:**
- `@tensorflow/tfjs-node` (native prebuilt binary) failed to install — no prebuilt
  binary for this Node/napi version, and node-gyp's source-build fallback needs
  Visual Studio Build Tools, which aren't installed on this machine.
- `@vladmandic/human` (a higher-level face/body/hand detection wrapper) has real
  bugs in its Node.js WASM path: its own `package.json` exports map has malformed
  keys (missing the required `./` prefix, so Node silently refuses to resolve them),
  it ignores a custom WASM path passed via the public API, and its model loader
  calls `fetch()` on `file://` URLs, which Node's fetch doesn't support.

Landed on the standalone `@tensorflow-models/blazeface` + `@tensorflow/tfjs-backend-cpu`
instead — plain JS, no native compilation, no WASM binary path issues. It fetches
its (small) model from `tfhub.dev` on first use per process and keeps it in memory
after that (see [README.md § 8](README.md#8-known-caveats-of-the-free-stack)).

**Also fixed a real pre-existing bug found while building this**: the zoompan
filter never set explicit `x`/`y`, so ffmpeg defaulted to anchoring the zoom at the
frame's top-left corner instead of the center — every video before this was subtly
zooming toward a corner, not zooming in on the middle of the shot as intended. Now
fixed for both the face-detected and no-face-found cases.

## Feature added beyond spec: original AI sports-poster graphics, no real-photo reuse

`USE_ARTICLE_IMAGE` (default **false**) can make step 03 try the real photo from the
article first — RSS `enclosure`/Media RSS tags, then the article page's `og:image`
tag, via `src/pipeline/image-extraction.js` (pure, unit-tested) +
`src/pipeline/03-generateImage.js` — before generating an AI image. **It's off by
default.** It was briefly turned on, then verified live that a real BBC Sport RSS
item's article-page image was a BBC-branded promotional graphic — their logo baked
into the corner, a named real public figure (Alan Shearer) as the subject — a clear
copyright/trademark exposure if republished, not a neutral news photo. The user then
asked for a "no logo" original-graphic-design workflow instead, which is a better
fit for that goal, so the default flipped back to `false`. There is still no
automated filter if you turn it on.

Step 02's Ollama system prompt was rewritten as a sports graphic designer/editor
persona: it treats the RSS title/snippet as its only verified facts (no inventing
scores/quotes), phrases things as a "developing story" when the snippet doesn't
state a result, and adds two new fields — `posterHeadline` (short, on-screen
headline) and `posterSubtext` (a stat/context line, or "Developing Story"/"Latest
Update" when facts are thin). Step 06 burns these onto the video as a designed
graphic using the bundled `Anton` font (`assets/fonts/`, OFL-licensed) via ffmpeg
`drawtext` — deliberately not relying on the AI image model to render text, since
free diffusion models (Pollinations) render text as illegible garbage almost every
time. Text is written to a temp file and referenced via `textfile=`, not inline
`text=`, specifically to avoid ffmpeg's fragile drawtext quoting for apostrophes in
real headlines (e.g. "Dragons' play-off hopes"). Subtext position is computed from
the headline's actual wrapped line count (`src/utils/textWrap.js`, unit-tested) —
an earlier fixed-offset version overlapped when a fallback headline wrapped to 3
lines; verified fixed by re-rendering an actual frame from an assembled video.

## Deviation from spec: YouTube upload removed, Facebook is the only publish target

The spec's step 07 (YouTube upload) was removed entirely at the user's request —
`src/pipeline/07-uploadYouTube.js` and `scripts/youtube-auth.js` are deleted, along
with all `YT_*`/`googleapis`/`tokens/` references (config, `.env.example`, README,
`package.json`). `src/pipeline/run.js`'s orchestrator now goes straight from step 06
(assemble video) to step 08 (post Facebook) — there's no step 07 in between, and
there's no more `partial_success` status (that existed specifically for "YouTube
succeeded, Facebook failed," which no longer applies).

Facebook posting is now optional at runtime, not required at startup: previously
`FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN` were required unless `DRY_RUN=true` (config.js
would `process.exit(1)` at boot without them). Now they're not required at all —
`src/pipeline/08-postFacebook.js` checks for them itself and skips gracefully (logs
a warning, returns `{skipped: true}`) if either is missing, exactly like `DRY_RUN`
already did. This means the full pipeline (through video assembly) can run and be
inspected via the admin dashboard with zero Facebook credentials configured.

## Deviation from spec: local JSON storage, not MongoDB

The original spec ([SPORTS_AUTOMATION_SPEC.md](SPORTS_AUTOMATION_SPEC.md)) specifies
MongoDB via Mongoose. That was changed at the user's request to keep everything
running on-PC with zero external services: `src/db/articleStore.js` and
`src/db/runStore.js` now read/write plain JSON files (`data/articles.json`,
`data/runs.json`) via `src/db/jsonFile.js`, an atomic write-and-rename file store with
an in-process write queue to prevent corruption from concurrent writes. Every other
module that used to import Mongoose models now calls these store functions instead —
`src/pipeline/run.js`, `src/pipeline/01-fetchNews.js`, `src/admin/server.js`,
`src/index.js`, `scripts/check-deps.js`.

Practical effect: no `MONGO_URI` env var, no database install step, `check-deps`
checks that `DATA_DIR` (default `./data`) is writable instead of pinging a database.

## What's NOT yet done on this machine

These are one-time local installs, not code — see [README.md § 1](README.md#1-one-time-local-installs)
for exact steps:

- [x] Facebook Page access token — `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN` now set in
      `.env`. Not yet confirmed with a real successful post.
- [x] Node.js 20+ — installed
- [x] FFmpeg — installed and on PATH
- [x] Ollama — installed. Whichever model you pull, set `OLLAMA_MODEL` in `.env` to
      match exactly (spec default is `llama3.1:8b`) — a mismatched name causes an
      Ollama 404, which the pipeline handles gracefully via the fallback template,
      but it means you're not actually getting LLM-generated scripts.
- [x] Piper TTS — binary + `en_US-ryan-high` voice model downloaded into
      `assets/piper/`. Confirmed generating real voiceovers.
- [x] Local JSON storage — no install needed, just a writable `DATA_DIR`.

Use `DRY_RUN=true` in `.env` and `npm run check-deps` to see exactly what's still
missing, with an install hint for each failing check.

## Quick orientation for a fresh machine

1. `cd sports-automation && npm install`
2. `copy .env.example .env` and fill in values (see README § 2)
3. `npm run check-deps` — fix whatever it flags
4. `npm test` — should pass regardless of what's installed
5. `npm run test-run` — runs the full pipeline once end-to-end (`DRY_RUN=true`, or
   simply no `FB_PAGE_ACCESS_TOKEN` set, skips the Facebook post step)
6. `npm run admin` — standalone admin dashboard at `http://localhost:4321`, no
   dependencies beyond a writable `DATA_DIR` — browse run history / article queue
   and manually trigger a run while the rest of setup is in progress
7. `pm2 start ecosystem.config.cjs` — run it for real, 24/7

## Key design decisions worth knowing about

- **Never re-posts a video on retry.** An article is only rolled back to `pending`
  on failure if no Facebook post has happened yet (`src/pipeline/run.js`). Once the
  Facebook post succeeds, that article is done.
- **Every generative step has a free fallback**, so a flaky free service can't kill a
  run: Ollama → template content, Pollinations → ffmpeg gradient background.
- **Concurrency-locked**: a tick is skipped if a previous run is still `running`;
  stale `running` runs older than 45 minutes are auto-recovered as `failed` at
  startup.
- **Admin dashboard is decoupled from the dep-check gate.** `npm start` still fails
  fast if ffmpeg/Ollama/Piper aren't reachable (by spec design), but `npm run admin`
  only needs a writable data directory, so you can watch run history and trigger
  runs while other pieces are still being installed.
- **Storage is atomic-write JSON files**, not a database (see "Deviation from spec"
  above) — `src/db/jsonFile.js` writes to a temp file then renames, and serializes
  all mutations through an in-process queue so concurrent writes can't corrupt the
  file.
- **Runs can be cancelled and resumed from the dashboard.** Stop (on a `running` run)
  aborts in-flight HTTP calls and kills the active Piper/ffmpeg child process
  immediately via `AbortSignal` (`src/utils/cancellation.js`); the run is marked
  `cancelled`, not `failed`. Continue (on a `failed`/`cancelled` run) re-enters
  `src/pipeline/run.js`'s `executePipeline` for that same runId and reuses any step's
  output file that's already on disk instead of regenerating it — verified live by
  cancelling a run mid-Ollama-call and confirming Continue resumed and completed it.
