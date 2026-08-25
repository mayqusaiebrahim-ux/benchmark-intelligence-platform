# Deployment Guide — Benchmark Intelligence Platform

**Status: prepared, not deployed.** This document is a readiness review plus the deployment scaffolding needed to deploy later. Nothing has been pushed to any hosting provider. No application code (`server.js`, `public/`, `lib/`, `11_Benchmark_Engine/modules|orchestrator`) was modified — only new, additive deployment files were created (listed in §4) and the repo's git hygiene was audited (§5), not changed.

---

## 1. Runtime Requirements

| Requirement | Detail |
|---|---|
| **Node.js** | 20.x LTS recommended. The code uses native ES modules (`"type": "module"` in both `package.json`s) and modern syntax throughout — no Node <18 features are used, but 20 LTS is the safest match for `openai@6.x` and `playwright@1.61.x`, both current-generation packages. |
| **npm** | Ships with Node 20; no separate install needed. |
| **Two independent dependency trees** | `10_Dashboard/package.json` (express only) and `11_Benchmark_Engine/package.json` (openai, playwright) are **both required at runtime**, not just the Dashboard's. See §3.1 — this is not optional. |
| **Playwright browser binaries** | `npm install` alone only installs the Playwright *Node package* (~33MB). The actual Chromium binary (~150–300MB) must be installed separately via `npx playwright install chromium`. **Not `--with-deps`**: confirmed on Render's native (non-Docker) Node build environment, `--with-deps`'s internal `apt-get install` step requires root, which that build environment does not grant (`su: Authentication failure`) — the build fails outright. Plain `playwright install chromium` (binary only, no system-library install step) succeeds there; Render's base image already carries the shared libraries Chromium needs at runtime. **Two separate installs are required, not one**: `11_Benchmark_Engine` and `12_Provider_Layer` each have their own independent `playwright` npm package (`BrowserSessionManager.js`'s `chromium.launch()` — the Navigation Stage's own browser — resolves through `12_Provider_Layer`'s copy, not the Engine's); `install:browsers` in the root `package.json` runs `playwright install chromium` for both. **`PLAYWRIGHT_BROWSERS_PATH=0`** is also required, and must be present on **both** the build command (where `playwright install chromium` runs) **and** the start command (where `chromium.launch()` runs) — confirmed the default shared cache (`$HOME/.cache/ms-playwright`) does not reliably survive Render's build → runtime transition ("Executable doesn't exist at /opt/render/.cache/ms-playwright/..."). `render.yaml` inlines it directly on both commands (`PLAYWRIGHT_BROWSERS_PATH=0 npm install` / `PLAYWRIGHT_BROWSERS_PATH=0 npm start`) rather than via the separate `envVars` list — the mechanism itself (the install command, and PLAYWRIGHT_BROWSERS_PATH's effect on it) was confirmed to work correctly when the var is actually present; whether Render's `envVars` list reaches an already-deployed service's runtime without a manual Blueprint re-sync is not verifiable from this repo, but is the most likely explanation given the build succeeding while runtime still showed the old cache path. Inlining removes the dependency on that mechanism regardless of which explanation is correct. |
| **Persistent writable disk** | The app reads *and writes* to the project filesystem outside its own server folder (see §3.2) — `Benchmark_Requests.json`, `Master_Benchmark_Matrix.json`, and `03_Screenshots/**`. A platform with only an ephemeral/read-only filesystem will lose all new benchmark data on every restart or redeploy. |
| **Long-running process, not serverless** | `app.listen()` runs indefinitely; Playwright launches a real browser process. This rules out classic serverless/edge function platforms (see §6). |

---

## 2. package.json Verification

**`10_Dashboard/package.json`** — valid, minimal, correct for its role:
```json
{
  "type": "module",
  "scripts": { "start": "node server.js", "dev": "node --watch server.js" },
  "dependencies": { "express": "^4.18.2" }
}
```
`npm start` works standalone *only if* `../11_Benchmark_Engine/node_modules` already exists, because `server.js` imports it directly (see §3.1). Verified: `package-lock.json` present and in sync.

**`11_Benchmark_Engine/package.json`** — valid:
```json
{
  "type": "module",
  "dependencies": { "openai": "^6.45.0", "playwright": "^1.61.1" }
}
```
No `postinstall` script to fetch Playwright's browser binary — confirmed absent. This must be a separate build step (already wired into the root `package.json` created in §4).

**Root of the project** — had **no `package.json` at all** before this review. Most PaaS auto-detection (Railway's Nixpacks, Render's Node runtime) looks for a `package.json` at the service's root directory to recognize it as a Node app and to know what to run. Without one, auto-detect would likely fail or guess wrong. **Created** — see §4.1.

---

## 3. server.js Startup Verification

Traced `10_Dashboard/server.js` end to end. Two findings, one blocking, one architectural-but-manageable.

### 3.1 Hard dependency on the sibling Engine folder (architectural, handled — not a bug to fix)
```js
import { startBenchmark } from '../11_Benchmark_Engine/orchestrator/index.js';
```
This is a **top-level, unconditional import**. `orchestrator/index.js` in turn imports `runDiscovery` and `captureScreenshot`, which pull in Playwright. Practically: **the Dashboard server cannot boot at all** unless `11_Benchmark_Engine/node_modules` (including Playwright) is fully installed — even though most of the Dashboard's own pages never touch Playwright. This is by design in the current codebase, not a defect, but it means "deploy the Dashboard" always means "install the Engine too." The root `package.json` created in §4.1 handles this automatically; a platform that only installs `10_Dashboard/` in isolation will crash on the very first request.

### 3.2 Filesystem root is one level *above* the Dashboard folder (architectural, handled — not a bug to fix)
```js
const PROJECT = join(__dirname, '..');   // AI_Travel_Benchmark_2026/ folder
```
Every API route reads from `PROJECT` — i.e., `02_Benchmark_Repository/`, `03_Screenshots/`, `Master_Benchmark_Matrix.json`, `Benchmark_Requests.json`, all of which live as **siblings of `10_Dashboard/`, one directory up**. This means:
- The **deploy root must be the whole project folder** (`AI_Travel_Benchmark_2026/`), not `10_Dashboard/` alone. Setting a hosting platform's "root directory" to `10_Dashboard/` will break every API route.
- `requestsStore.js` also **writes** to `Master_Benchmark_Matrix.json` and `Benchmark_Requests.json` at that same level (confirmed via `writeFileSync` calls) — this data must live on a persistent, writable volume, not the platform's ephemeral build filesystem, or every new benchmark request submitted through the deployed UI will vanish on the next restart.

### 3.3 Hardcoded port — **blocking, requires a code change I did not make**
```js
const PORT = 3000;
...
app.listen(PORT, ...);
```
This does **not** read `process.env.PORT`. Railway and Render (and most PaaS) assign a dynamic port at runtime via that exact environment variable and route external traffic only to it — an app that always binds to a fixed 3000 will fail Render's port-detection health check outright, and will unpredictably fail on Railway depending on what it assigns.

**This is the one change the application needs before it can run on either platform, and I did not make it**, per "do not change the application." The fix, when you're ready to authorize it, is a one-line, behavior-neutral change:
```diff
- const PORT = 3000;
+ const PORT = process.env.PORT || 3000;
```
Everything else about local development (`node server.js` → `http://localhost:3000`) keeps working exactly as before; only the deployed environment behaves differently. Nothing else in `server.js` needs to change.

---

## 4. Deployment Files Created

All additive — no existing file was edited.

### 4.1 `package.json` (new, project root)
Orchestrates installing **both** `10_Dashboard/` and `11_Benchmark_Engine/`, then fetching Playwright's Chromium binary, then starting the server:
```json
{
  "scripts": {
    "install:dashboard": "npm install --prefix 10_Dashboard",
    "install:engine": "npm install --prefix 11_Benchmark_Engine",
    "install:browsers": "npx --prefix 11_Benchmark_Engine playwright install chromium && npx --prefix 12_Provider_Layer playwright install chromium",
    "postinstall": "npm run install:dashboard && npm run install:engine && npm run install:browsers",
    "start": "node 10_Dashboard/server.js"
  }
}
```
This is the file that makes "one `npm install`, one `npm start`, from the project root" work at all — without it, no PaaS auto-build would know to install the Engine's dependencies or fetch Chromium.

### 4.2 `.gitignore` (new, project root)
Was **completely absent** from the repo before this review (see §5.1 for why that matters). Excludes `node_modules/`, `.env*` (except `.env.example`), Playwright test artifacts, and log files.

### 4.3 `11_Benchmark_Engine/.env.example` (new)
Documents the one required secret (`OPENAI_API_KEY`) without exposing the real value. The real `.env` already existed and was confirmed **not** committed to git (good) — see §5.2.

### 4.4 `Procfile` (new, project root)
`web: node 10_Dashboard/server.js` — works for Railway and any Heroku-style buildpack detection.

### 4.5 `render.yaml` (new, project root)
A Render Blueprint pre-wired with the correct build and start commands (`PLAYWRIGHT_BROWSERS_PATH=0 npm install` / `PLAYWRIGHT_BROWSERS_PATH=0 npm start` — the env var is inlined on both commands rather than placed in the separate `envVars` list, since an `envVars` addition to an already-deployed service was confirmed not to reach the runtime process without a manual Blueprint re-sync; inlining removes that dependency), a persistent disk mount, and the `OPENAI_API_KEY` secret slot. Includes an inline comment flagging the §3.3 port issue so it isn't missed at deploy time.

---

## 5. Repository Hygiene Findings (found, not fixed — needs your decision)

These are pre-existing conditions in the repository, discovered during this review. None were altered, since fixing them means rewriting git history/tracked files, which deserves your explicit go-ahead rather than a silent fix.

### 5.1 Three separate `.git` directories in one project tree
```
AI_Travel_Benchmark_2026/.git                          ← empty, no commits yet, same remote
AI_Travel_Benchmark_2026/AI_Travel_Benchmark_2026/.git  ← real repo, in sync with origin/main
AI_Travel_Benchmark_2026/AI_Travel_Benchmark_2026/10_Dashboard/.git ← duplicate of the same commit (89be967)
```
All three point at `github.com/mayqusaiebrahim-ux/benchmark-intelligence-platform`. **The middle one (the inner `AI_Travel_Benchmark_2026/` folder) is the real, canonical repo** — it's the one in sync with `origin/main`, and it's the folder that must be the deploy root per §3.2. The outer one is an uninitialized stray (harmless, but shouldn't be pushed from). The one inside `10_Dashboard/` is a duplicate of the exact same single commit and should almost certainly be deleted (`rm -rf 10_Dashboard/.git`) so that folder stops being its own nested repo — left as-is, it risks someone committing from inside `10_Dashboard/` and silently diverging from the real history. **I did not delete it — that's your call to make.**

### 5.2 `node_modules/` is already committed inside the real repo
`git ls-files` from the inner repo shows 618 tracked paths under `10_Dashboard/node_modules/` (e.g. `node_modules/.bin/mime`, `node_modules/accepts/HISTORY.md`). The `.gitignore` created in §4.2 stops this from getting *worse*, but it does **not** retroactively remove what's already tracked. Before your first real push for deployment, you'll want to run (from the inner repo root):
```
git rm -r --cached 10_Dashboard/node_modules
git commit -m "Stop tracking node_modules"
```
`11_Benchmark_Engine/node_modules/` is, by contrast, **not** currently tracked — only the Dashboard's was committed. I did not run the `git rm --cached` above; it changes tracked history and should be a deliberate commit you make yourself.

### 5.3 Secrets — confirmed clean
`11_Benchmark_Engine/.env` (holding `OPENAI_API_KEY`) is **not** tracked in any of the three repos. Good — no key rotation needed. Keep it that way: the new `.gitignore` excludes it going forward, and the real key must be entered into whichever platform's environment-variable settings you deploy to, never into a file that gets committed.

---

## 6. Hosting Platform Recommendation: **Railway**, with Render as a solid second choice

Both platforms were evaluated against what this specific app actually needs — not a generic checklist.

| Requirement (from §1–§3) | Railway | Render |
|---|---|---|
| Persistent writable volume for `03_Screenshots/`, `Master_Benchmark_Matrix.json`, `Benchmark_Requests.json` | ✅ Volumes available on all paid plans, simple to mount | ⚠️ Persistent Disks require a paid instance type — **not available on the free tier at all** |
| Long-running Node process, no cold starts | ✅ No idle spin-down on paid plans | ⚠️ Free/starter web services spin down after ~15 min idle; next request pays a 30–50s cold-start penalty — poor fit for an internal tool people check throughout the day |
| Docker / custom build for Playwright + Chromium system deps | ✅ Supports Dockerfile or Nixpacks with custom build command | ✅ Native Docker support, equally capable |
| Multi-folder monorepo with a root `package.json` driving subfolder installs | ✅ Nixpacks respects root `package.json` scripts directly | ✅ Also works via `render.yaml` buildCommand |
| Simplicity for an **internal-only** team tool (no custom domain/CDN urgency) | ✅ Minimal config, fast iteration | ✅ Comparable, slightly more YAML ceremony |

**Recommendation: Railway.** The deciding factors are the two rows that actually matter for this app's architecture: it needs a **volume that's genuinely persistent without upgrading past a free/hobby tier**, and it needs to **never cold-start**, since the entire point of an internal benchmark dashboard is that teammates check it ad hoc during the day — a 30–50 second wake-up penalty on Render's free tier would make it feel broken. Render remains a fully valid second choice if the team already standardizes on Render for other internal tools or wants `render.yaml`'s more explicit infra-as-code — the Blueprint in §4.5 is ready either way.

**Ruled out:** Vercel, Netlify, and other edge/serverless-function platforms. This app fails their core assumptions on three separate counts — it needs a persistent filesystem (these platforms are stateless per-invocation), it needs a long-lived process (these platforms have short execution-time limits, typically 10–60s, incompatible with launching a real Chromium instance via Playwright), and its single Express app serves both the API and the SPA from one continuously-running process rather than discrete functions.

---

## 7. Step-by-Step Deployment Guide (Railway)

Run this once you've decided on §3.3 and §5.1–5.2.

1. **Apply the one required code change** (§3.3) in `10_Dashboard/server.js`:
   `const PORT = 3000;` → `const PORT = process.env.PORT || 3000;`
2. **Clean up git hygiene** (§5.1, §5.2) from the inner repo root:
   - `rm -rf 10_Dashboard/.git`
   - `git rm -r --cached 10_Dashboard/node_modules && git commit -m "Stop tracking node_modules"`
3. **Commit the new deployment files** created in §4 (`package.json`, `.gitignore`, `.env.example`, `Procfile`, `render.yaml`) and push to `origin/main`.
4. **Railway → New Project → Deploy from GitHub repo** → select `benchmark-intelligence-platform`.
   - Root Directory: the inner project folder (where the new root `package.json` now lives) — **not** `10_Dashboard`.
   - Build Command: leave default (Nixpacks will run `npm install`, which triggers the `postinstall` chain in §4.1).
   - Start Command: leave default (`npm start`, from `package.json`).
5. **Add a Volume**: mount it at the project root so `03_Screenshots/`, `02_Benchmark_Repository/`, `Master_Benchmark_Matrix.json`, and `Benchmark_Requests.json` all persist across restarts and redeploys. (The existing 313MB of project data, screenshots included, ships in via the initial git push; the volume only needs to persist *new* writes from that point forward.)
6. **Environment Variables**: add `OPENAI_API_KEY` (the real value, from your local `11_Benchmark_Engine/.env` — never commit it).
7. **Deploy**, then confirm in the build logs that `playwright install chromium` completed for **both** `11_Benchmark_Engine` and `12_Provider_Layer` (each downloads ~150–300MB and can take a few minutes on first deploy).
8. **Verify**: hit the deployed URL, confirm `/api/stats`, `/api/homepage-benchmarks`, and a screenshot URL (e.g. `/screenshots/saudia_2026-07-13T00-00-00-000Z.png`) all return `200` — the same three checks used to verify this app locally throughout this project's development.

Render's equivalent steps are the same, using `render.yaml` (§4.5) as a Blueprint instead of manual dashboard configuration, with the caveat that the Starter (paid) plan is required for the persistent Disk to be available at all.
