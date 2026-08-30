# Persistence audit — Feature Benchmark runtime state

**Scope:** documentation only. No storage service is implemented in the
CRITICAL CORRECTNESS FIX commit. This file records what is lost today and the
smallest fix to do next, kept separate from the correctness work.

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
