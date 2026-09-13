#!/usr/bin/env node
/**
 * scripts/proveNavigation.mjs — THE PROOF SCRIPT.
 *
 * Answers one question and nothing else: on a REAL website, can the universal
 * hybrid agent understand the page, click and fill what it needs, and actually
 * REACH the requested experience?
 *
 * It deliberately skips the rest of the platform — no dashboard, no Clerk, no
 * Vision, no reasoning, no R2, no Browserbase. It needs exactly one secret,
 * ANTHROPIC_API_KEY, and a local Chromium (already installed by Playwright).
 *
 * RUN (from the project root):
 *   node --env-file=10_Dashboard/.env scripts/proveNavigation.mjs
 *
 * With arguments:
 *   node --env-file=10_Dashboard/.env scripts/proveNavigation.mjs \
 *        "Etihad" "https://www.etihad.com/en-ae/" "Passenger Details"
 *
 * Watch the browser window: the agent drives it in front of you. Everything it
 * does is printed as agent_nav_* lines, and every screenshot path is listed at
 * the end.
 */
import { runAutonomousNavigation, buildStagehandConstructorOptions, validateAgentConfiguration, detectAgentLlm } from '../11_Benchmark_Engine/modules/autonomous_navigator/autonomousNavigator.js';
import { buildSystemPrompt } from '../11_Benchmark_Engine/modules/autonomous_navigator/agentInstructions.js';
import { mapFeatureToDetectorKey } from '../13_Orchestrator/featureNavigation/featureIntent.js';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Local Chromium, agent mode. Set before anything reads them.
process.env.BROWSER_PROVIDER = 'local';
process.env.NAVIGATION_MODE = 'agent';

const [, , companyArg, urlArg, featureArg, headlessArg] = process.argv;
const company = companyArg || 'Etihad';
const url = urlArg || 'https://www.etihad.com/en-ae/';
const feature = featureArg || 'Passenger Details';
const headless = headlessArg === 'headless';

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(72));

rule();
line(`  COMPANY : ${company}`);
line(`  URL     : ${url}`);
line(`  TARGET  : ${feature}`);
rule();

if (!process.env.ANTHROPIC_API_KEY) {
  line('\n✖ ANTHROPIC_API_KEY is not set in this process.');
  line('  Run it as:  node --env-file=10_Dashboard/.env scripts/proveNavigation.mjs');
  line('  (this project has no dotenv — .env is only read via --env-file)\n');
  process.exit(1);
}

const cfg = validateAgentConfiguration();
if (!cfg.ok) {
  line(`\n✖ agent configuration unusable: ${cfg.reason}\n`);
  process.exit(1);
}
const llm = detectAgentLlm();
line(`  model   : ${llm.model}`);
line(`  mode    : ${cfg.agentMode}${cfg.agentMode === 'hybrid' ? '  (DOM + visual)' : '  ← DOM only, custom widgets will likely fail'}`);
line(`  browser : local Chromium${headless ? ' (headless)' : ' — a window will open, watch it'}`);
const detectorKey = mapFeatureToDetectorKey(feature);
line(`  verify  : ${detectorKey ? `detector "${detectorKey}" (+ generic fallback)` : 'generic verifier'}`);
rule();
line('');

// Stagehand is installed INSIDE 11_Benchmark_Engine (see the root postinstall),
// not at the project root — a bare `import '@browserbasehq/stagehand'` from
// scripts/ does not resolve. Import its ESM entry by absolute path instead.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STAGEHAND_ENTRY = [
  join(ROOT, '11_Benchmark_Engine', 'node_modules', '@browserbasehq', 'stagehand', 'dist', 'esm', 'index.js'),
  join(ROOT, 'node_modules', '@browserbasehq', 'stagehand', 'dist', 'esm', 'index.js'),
  join(ROOT, '10_Dashboard', 'node_modules', '@browserbasehq', 'stagehand', 'dist', 'esm', 'index.js'),
].find((p) => existsSync(p));

if (!STAGEHAND_ENTRY) {
  line('\n✖ could not find @browserbasehq/stagehand.');
  line('  Install it with:  npm install --prefix 11_Benchmark_Engine\n');
  process.exit(1);
}
line(`  stagehand : ${STAGEHAND_ENTRY.replace(ROOT, '')}`);

// Stagehand's LOCAL mode launches through chrome-launcher, which looks for a
// real Chrome/Chromium install (CHROME_PATH or the OS default locations) — it
// does NOT use Playwright's bundled browser by itself. Prefer the Playwright
// Chromium this project already installed (a throwaway binary, never the
// user's own Chrome profile), then fall back to an installed Chrome.
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const home = homedir();
  // Real Chrome FIRST: chrome-launcher (what Stagehand uses in LOCAL mode) is
  // built and tested against a stock Chrome install. It launches with its own
  // throwaway profile directory, so the user's own Chrome profile, tabs and
  // sessions are never touched. Playwright's Chromium is only the fallback —
  // it does not always bring up the remote-debugging port chrome-launcher
  // waits for (symptom: "connect ECONNREFUSED 127.0.0.1:<port>").
  for (const p of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]) if (existsSync(p)) return p;

  const pwRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright'),
    join(home, 'Library', 'Caches', 'ms-playwright'),
    join(home, '.cache', 'ms-playwright'),
  ].filter((p) => p && existsSync(p));
  for (const root of pwRoots) {
    let dirs = [];
    try { dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse(); } catch { /* ignore */ }
    for (const d of dirs) {
      for (const rel of [
        ['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
        ['chrome-linux', 'chrome'],
      ]) {
        const p = join(root, d, ...rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const chromePath = findChrome();
line(`  chrome    : ${chromePath || 'not found — letting chrome-launcher search'}`);
rule();
line('');

// Same options the product uses, plus a visible window so the run can be watched.
async function stagehandFactory() {
  const mod = await import(pathToFileURL(STAGEHAND_ENTRY).href);
  const Stagehand = mod.Stagehand || mod.V3 || (mod.default && (mod.default.Stagehand || mod.default.V3));
  if (!Stagehand) throw new Error('stagehand did not export Stagehand/V3');
  return new Stagehand({
    ...buildStagehandConstructorOptions(),
    systemPrompt: buildSystemPrompt(),
    localBrowserLaunchOptions: {
      headless,
      viewport: { width: 1440, height: 900 },
      ...(chromePath ? { executablePath: chromePath } : {}),
      // slow machines / cold Chrome start need more than the 15s default
      connectTimeoutMs: 60_000,
    },
  });
}

const startedAt = Date.now();
let res;
try {
  res = await runAutonomousNavigation({
    startingUrl: url,
    company,
    feature,
    detectorKey,
    stagehandFactory,
  });
} catch (err) {
  line('');
  rule();
  line(`✖ the run threw before producing a result: ${err.message}`);
  rule();
  process.exit(1);
}

const secs = Math.round((Date.now() - startedAt) / 1000);
line('');
rule();
line(`  RESULT           ${res.targetReached ? '✔ TARGET REACHED' : '✖ NOT REACHED'}`);
line(`  status           ${res.targetStatus}`);
line(`  confidence       ${res.confidence}`);
line(`  verified by      ${res.verifierMethod || '—'}`);
line(`  agent mode       ${res.agentMode}`);
line(`  agent actions    ${res.agentActionsEmitted}`);
line(`  deepest url      ${res.deepestUrl}`);
line(`  headings there   ${(res.deepestHeadings || []).slice(0, 5).join(' | ') || '—'}`);
line(`  elapsed          ${secs}s`);
if (res.safetyBlocks && res.safetyBlocks.length) {
  line(`  safety stops     ${res.safetyBlocks.length}`);
  for (const b of res.safetyBlocks.slice(0, 3)) line(`                   - ${b.why}`);
}
if (!res.targetReached) line(`  blocker          ${res.blocker}`);
if (/ECONNREFUSED|Timed out waiting for \/json\/version/i.test(res.blocker || '')) {
  line('');
  line('  ↳ Chrome started but never opened its remote-debugging port.');
  line('    Try a different browser binary, e.g.:');
  line('      $env:CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
  line('    then run this script again. Close any Chrome windows first.');
}
rule();

line('\n  WHAT THE AGENT DID');
const acts = res.interactionsPerformed || [];
if (!acts.length) line('    (nothing recorded — the agent never acted)');
for (const [i, a] of acts.slice(0, 40).entries()) line(`    ${String(i + 1).padStart(2)}. ${a}`);

line('\n  SCREENSHOTS  (open the last one — it is the real evidence)');
for (const m of res.milestones || []) line(`    ${String(m.label).padEnd(28)} ${m.path}`);
if (res.evidence && res.evidence.screenshotPath) {
  line(`    ${'TERMINAL (the evidence)'.padEnd(28)} ${res.evidence.screenshotPath}`);
  line(`    ${'page title'.padEnd(28)} ${res.evidence.pageTitle || '—'}`);
}
line('');

process.exit(res.targetReached ? 0 : 2);
