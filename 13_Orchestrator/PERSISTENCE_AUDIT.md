# Persistence audit — Feature Benchmark runtime state

**Status: RESOLVED.** The persistence layer below was implemented in the
"PERSISTENCE FIX — KEEP RENDER, ADD CLOUDFLARE R2" commit. This file is kept
as the audit + design record.

**What was built:** `STORAGE_PROVIDER=local` (default, unchanged behaviour) or
`STORAGE_PROVIDER=r2`. In `r2` mode the local filesystem stays the active
working/cache directory (no `fs` call site became async) and Cloudflare R2 —
via its S3 API, signed with the zero-dependency `aws4fetch` — is the
persistent source of truth for *generated runtime artifacts only*:

| Local file | R2 object key | When written | When restored |
|---|---|---|---|
| `Benchmark_Requests.json` | `state/Benchmark_Requests.json` | every `writeRequests()` (write-through, tracked) | eagerly on boot, before the server accepts requests — R2 wins over the stale repo copy |
| `_Feature_Benchmarks/<feature>/<requestId>.md` | `feature-benchmarks/<feature>/<requestId>.md` | in `featureReportWriterStage` — run fails if the upload fails | eagerly on boot (small text); also on-demand via `GET /api/markdown` |
| evidence screenshot | `screenshots/<requestId>/<file>.png` | in `featureVisionStage` — run fails if the upload fails | lazily, on-demand, via `GET /api/evidence/:requestId/:filename` |
| Vision findings | `screenshots/<requestId>/vision.json` | in `featureVisionStage` | lazily |
| navigation run manifest | `navigation/<requestId>/run_manifest.json` | in `featureVisionStage` | lazily |

`requestId` (the collision-resistant `req_<epoch-ms>_<hex>` id) is the primary
key for every run's objects — never a mutable company label. Old
`req_YYYYMMDD_NNN.md` report paths still map correctly (the key is derived
from the `_Feature_Benchmarks/<feature>/<file>.md` tail).

**Availability is gated up front.** Before a new Feature Benchmark spends any
Browserbase / Discovery / Vision / Anthropic work, `benchmarkService` runs
`checkStorageHealth()` — one lightweight, non-destructive `ListObjectsV2`
(capped at 1 key) against the bucket. If `STORAGE_PROVIDER=r2` and that probe
fails (bad credentials, missing bucket, network), the run fails immediately
with *"Persistent storage is currently unavailable. Benchmark was not
started."* and the orchestrator is never invoked. `STORAGE_PROVIDER=local`
reports healthy (skipped) — unchanged.

**Completion is gated on persistence.** A Feature Benchmark cannot stand as
`completed` unless, in `r2` mode: the report uploaded (else the run fails at
`feature_report_writer`), the evidence uploaded (else it fails at
`feature_vision`), and the final `Benchmark_Requests.json` write landed in R2
(else `benchmarkService` downgrades `completed` → `verification_failed` with a
clear "retry once storage is reachable" message). A failed state write is
logged as a clear, non-secret error and surfaced by `flushStatePersistence()`.

**Security:** the bucket is private; no R2 secret appears in the frontend, API
responses, logs or generated reports. `GET /api/markdown` only falls back to
R2 for validated `_Feature_Benchmarks/*.md` paths (`keyForMarkdownRequestPath`
rejects traversal / absolute paths / anything else) — it is not a generic
object reader. `GET /api/evidence` takes only `(requestId, filename)`, both
`^[A-Za-z0-9._-]+$`, and never lists the bucket.

**Not persisted** (intentionally): the static research repo
(`Master_Benchmark_Matrix.json`, the committed Mindtrip/Trip/Booking/ixigo
screenshots and reports — already in git), per-step raw `page.html` snapshots
(large, not consumed by any read path), and in-memory-only guards
(`benchmarkService.runStatus`, `activeHomepageRun`).

---

## Original audit (pre-fix)

---

## 1. What Render loses on restart / redeploy

The deployed app (`10_Dashboard/server.js`, `PROJECT = join(__dirname, '..')`)
reads **and writes** files that live one directory up from the server folder
— i.e. in the project checkout itself. On any platform whose filesystem is
ephemeral (reset on restart) or rebuilt on deploy, every write below is lost:

| Path (relative to project root) | Written by | What it holds | Lost = |
|---|---|---|---|
| `Benchmark_Requests.json` | `10_Dashboard/lib/requestsStore.js` (`createRequest`, `setStage`, `cancelRequest`) | Every wizard-created request, its per-competitor items, `stage`, timing, `url`, `execution_message` | The Queue/Activity view and the Benchmarks list go empty; a running benchmark's `setStage()` calls start throwing `Request "<id>" not found` (benchmarkService then aborts that run) |
| `02_Benchmark_Repository/_Feature_Benchmarks/<feature>/<requestId>.md` | `13_Orchestrator/stages/featureReportWriterStage.js` | The generated feature report markdown — the actual product deliverable | `#feature-report/<id>` shows "Report is still being generated"; `listCurrentFeatureBenchmarks()` reports `has_report: false` |
| `03_Screenshots/<slug>/_navigation_runs/<runId>/*.png` | `11_Benchmark_Engine/modules/navigation_runner/capture.js` | Per-step screenshots (the evidence Vision analysed) | The report can't be re-derived or audited; `verifyFeatureCompletion()`'s `evidence_exists` check fails on any re-verification |
| `03_Screenshots/<slug>_<ts>_vision.json` | `12_Provider_Layer/capabilities/vision/OpenAIVisionProvider.js` | The raw Vision detection findings | Vision evidence trail gone |
| `02_Benchmark_Repository/_Navigation_Runs/<slug>/<runId>/**` | `capture.js` (`page.html`, `metadata.json`, `run_manifest.json`) | HTML snapshots + per-run manifest | Navigation audit trail gone |
| `02_Benchmark_Repository/_Homepage_Benchmarks/**` | `11_Benchmark_Engine` homepage pipeline | Legacy homepage-scan reports (Archive tab) | Archive homepage experiments disappear |
| `Master_Benchmark_Matrix.json` | `requestsStore.js` `seedMatrixStub()` (Complete-Journey new-company stubs only) | Legacy matrix + pending stubs | Legacy Archive research list changes |
| `shared/logger.mjs` output | — | stdout only, not a file — **not** a persistence concern |

**Not a concern (in-memory only, intentionally lost — pre-existing):**
`benchmarkService.js`'s `runStatus` Map and `server.js`'s `activeHomepageRun`.
Those are fast-path guards; the persisted `item.stage` is the real source of
truth (and is itself in `Benchmark_Requests.json`, above).

### Why the correctness sprint reduces the blast radius but does not fix this

- **Collision-safe request IDs** (`req_<epoch-ms>_<8 hex>`) mean that if
  `Benchmark_Requests.json` reverts, a *new* run started afterward can no
  longer be handed the same id as a lost one and overwrite its report file.
  The lost run's data is still lost — but it can't corrupt a new run's.
- The completion gate + report target marker mean a restored/partial report
  file that doesn't belong to the current request is *detected* (gate fails)
  rather than trusted.

Neither makes the data survive a restart. That needs real storage.

### Does Render's `render.yaml` disk help?

`render.yaml` already declares a `disk` (`mountPath: /opt/render/project/src`,
`sizeGB: 2`) — but per `DEPLOYMENT.md §6`, a **persistent Disk on Render
requires a paid instance type; it is not available on the free tier at all.**
On the free tier the mount is ignored and the filesystem is ephemeral, which
is the observed "reports disappear after restart" behaviour. On a paid
Starter instance the disk does persist across restarts *and* redeploys, and
this problem goes away with no code change — the disk is the intended fix,
it just isn't free.

---

## 2. Smallest free persistent-storage option to implement next

Ranked by "smallest change to this codebase":

### Option A (recommended) — move the host to a platform with a free persistent volume
`DEPLOYMENT.md §6` already reaches this conclusion: **Railway** gives a
genuinely persistent volume on its free/hobby tier, mounted at the project
root, and never cold-starts. **Zero code change** — the volume just needs to
be mounted where the project checkout lives so `Benchmark_Requests.json`,
`02_Benchmark_Repository/**` and `03_Screenshots/**` land on it. This is the
smallest *total* change: infra config only.

### Option B — a tiny "state store" seam behind `requestsStore.js` + report writer
Keep files as the local-dev default; add one adapter that, when
`STATE_BACKEND=<url>` is set, mirrors two things to a free external store:

1. `Benchmark_Requests.json` (one small JSON blob — read on boot, write on
   every `writeRequests()`).
2. each `_Feature_Benchmarks/<feature>/<requestId>.md` on write, and read-back
   on a report-view miss.

Cheapest free backends that fit an internal tool:
- **Cloudflare R2 / Backblaze B2** (S3-compatible, free tier ~10 GB) — a
  `putObject`/`getObject` pair; screenshots can go here too.
- **Turso / Neon / Supabase free Postgres** — overkill for two blobs; only
  worth it if the matrix/queue grow into real relational data.
- **A private GitHub repo + the contents API** — free, durable, diffable;
  fine for the JSON + markdown (not the PNGs).

Surface area: one new file (`stateBackend.js`), ~3 call sites
(`writeRequests`, `readRequests` on boot, `featureReportWriterStage` write).
Screenshots are the awkward part — either also mirror them to R2/B2, or accept
that only the *report* survives (the report is self-contained; the screenshot
is corroborating evidence).

### Option C — SQLite on the paid Render disk
If the team stays on Render and pays for Starter, replace the JSON file with
a single SQLite DB on the persistent disk. More robust than a JSON blob
(atomic writes, no full-file rewrite race) but a bigger change and still not
free.

**Decision for the next commit:** Option A if the team is willing to move
hosts; otherwise Option B with R2/B2 for the JSON + markdown + screenshots.
Not started here — this sprint is correctness only.
