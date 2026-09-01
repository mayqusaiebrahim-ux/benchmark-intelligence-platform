/**
 * browserLauncher — the one shared place Feature Benchmark's two browser
 * entry points (discovery/index.js, navigation_runner/index.js) acquire a
 * Chromium session from.
 *
 * Why this exists: Render Free's 512MB was still insufficient for a local
 * headless Chromium even after the memory-optimization pass (smaller
 * launch flags, viewport-only screenshots, earlier browser.close()) — the
 * process kept being silently OOM-killed as soon as real browser work
 * began. This moves Chromium off Render entirely for production:
 * BROWSER_PROVIDER=browserbase connects to a remote, Browserbase-hosted
 * Chromium over CDP instead of launching one locally. Local development is
 * completely unaffected — BROWSER_PROVIDER=local (or the var unset) keeps
 * the exact existing chromium.launch() behavior, same flags as before.
 *
 * Shape compatibility: chromium.launch() and chromium.connectOverCDP()
 * both return the same Playwright Browser interface, so callers keep
 * using browser.newPage(), page.goto(), page.screenshot(), browser.on(
 * 'disconnected', ...), etc. completely unchanged — discovery/index.js and
 * navigation_runner/index.js did not need their navigation/interaction
 * logic touched at all, only the three lines that acquired and released
 * the browser.
 *
 * No silent fallback: if BROWSER_PROVIDER=browserbase and the remote
 * session can't be created or connected, this throws. It does NOT fall
 * back to a local chromium.launch() — a silent fallback is exactly the
 * configuration that OOM-killed Render in the first place, so failing
 * loudly here is a deliberate safety property, not an oversight. The
 * existing catch/logError/rethrow blocks already in discovery/index.js and
 * navigation_runner/index.js turn this into a clear, attributable stage
 * failure with no code changes needed on their side.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';
import { homedir, platform } from 'os';
import { logInfo, logError } from '../../shared/logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(__dirname, '..', '.env')); // 11_Benchmark_Engine/.env — shared with visionModelClient.js's own load
} catch {
  // No .env file present — fall back to whatever is already in process.env.
}

// Same rationale as the earlier memory-optimization pass: removes the
// unused headless GPU process, avoids /dev/shm-related memory pressure in
// containers, disables the unused crash reporter. Local-provider only —
// meaningless (and unused) when connecting to a remote session.
const MEMORY_OPTIMIZED_LAUNCH_ARGS = ['--disable-gpu', '--disable-dev-shm-usage', '--disable-breakpad'];

const BROWSERBASE_SESSIONS_URL = 'https://api.browserbase.com/v1/sessions';

// Playwright's DEFAULT browser download roots per OS (used only as a
// last-resort fallback when the env-driven resolution points at a Chromium
// that was never installed — e.g. a stray PLAYWRIGHT_BROWSERS_PATH=0).
function defaultMsPlaywrightRoots() {
  const p = platform();
  const home = homedir();
  if (p === 'win32') return [join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright')];
  if (p === 'darwin') return [join(home, 'Library', 'Caches', 'ms-playwright')];
  return [join(home, '.cache', 'ms-playwright')];
}

/** True for the "browser was never downloaded" launch error. */
export function isMissingBrowserError(message) {
  return /Executable doesn'?t exist|Please run the following command/i.test(String(message || ''));
}

/** Newest installed Chromium (full or headless-shell) executable, or null. */
export function findInstalledChromium() {
  const exeNames = platform() === 'win32'
    ? ['chrome.exe', 'chrome-headless-shell.exe']
    : (platform() === 'darwin' ? ['Chromium.app/Contents/MacOS/Chromium', 'chrome-headless-shell'] : ['chrome', 'chrome-headless-shell']);
  const subdirs = platform() === 'win32'
    ? ['chrome-win64', 'chrome-win', 'chrome-headless-shell-win64']
    : (platform() === 'darwin' ? ['chrome-mac', 'chrome-headless-shell-mac'] : ['chrome-linux', 'chrome-headless-shell-linux']);
  for (const root of defaultMsPlaywrightRoots()) {
    if (!existsSync(root)) continue;
    let entries;
    try { entries = readdirSync(root).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort().reverse(); }
    catch { continue; }
    for (const dir of entries) {
      for (const sub of subdirs) {
        for (const exe of exeNames) {
          const candidate = join(root, dir, sub, exe);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  return null;
}

async function launchLocal(label) {
  logInfo('browser_provider', { provider: 'local', label });
  let browser;
  try {
    browser = await chromium.launch({ args: MEMORY_OPTIMIZED_LAUNCH_ARGS });
  } catch (err) {
    // Seen locally: a stray PLAYWRIGHT_BROWSERS_PATH=0 in the environment
    // makes Playwright look for an in-package .local-browsers/ Chromium that
    // was never installed, so launch() throws "Executable doesn't exist at
    // …chrome-headless-shell.exe". Playwright's own chromium.executablePath()
    // still resolves the real download location — retry once with it before
    // giving up. Generic: no hardcoded path, no vendor-specific logic.
    if (!isMissingBrowserError(err.message)) throw err;
    const resolved = findInstalledChromium();
    logError('browser_launch_retry_with_executable_path', err, { provider: 'local', label, resolved });
    if (!resolved) throw err;
    browser = await chromium.launch({ args: MEMORY_OPTIMIZED_LAUNCH_ARGS, executablePath: resolved });
    logInfo('browser_launch_recovered_via_default_path', { provider: 'local', label, executablePath: resolved });
  }
  logInfo('browser_connected', { provider: 'local', label });

  return {
    browser,
    close: async () => {
      await browser.close();
      logInfo('browser_closed', { provider: 'local', label });
    },
  };
}

async function launchBrowserbase(label) {
  logInfo('browser_provider', { provider: 'browserbase', label });

  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    const err = new Error('BROWSER_PROVIDER=browserbase requires BROWSERBASE_API_KEY to be set.');
    logError('browser_session_create_failed', err, { provider: 'browserbase', label });
    throw err;
  }
  // Browserbase's session-creation API also expects a project id on most
  // accounts. Not listed among this sprint's required env vars, but
  // included defensively — sent only if present, so this stays correct
  // for account configurations that don't need it. Verify against your
  // own Browserbase project settings; this could not be confirmed against
  // a live account in this environment (no credentials available here).
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  let sessionId, connectUrl;
  try {
    const resp = await fetch(BROWSERBASE_SESSIONS_URL, {
      method: 'POST',
      headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(projectId ? { projectId } : {}),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      throw new Error(`Browserbase session creation failed: HTTP ${resp.status} ${bodyText}`.trim());
    }
    const data = await resp.json();
    sessionId = data.id;
    connectUrl = data.connectUrl;
    if (!connectUrl) {
      throw new Error('Browserbase session response did not include a connectUrl.');
    }
  } catch (err) {
    // Never log the API key — only the label/provider/whatever the error
    // itself says (the fetch body above never includes the key).
    logError('browser_session_create_failed', err, { provider: 'browserbase', label });
    throw err; // no local fallback
  }

  logInfo('browser_session_created', { provider: 'browserbase', label, sessionId });

  let browser;
  try {
    browser = await chromium.connectOverCDP(connectUrl);
  } catch (err) {
    logError('browser_connect_failed', err, { provider: 'browserbase', label, sessionId });
    throw err; // no local fallback
  }

  logInfo('browser_connected', { provider: 'browserbase', label, sessionId });

  return {
    browser,
    close: async () => {
      try {
        await browser.close(); // disconnects the CDP connection
      } catch (err) {
        logError('browser_close_error', err, { provider: 'browserbase', label, sessionId });
      }
      // Best-effort explicit remote session release — disconnecting CDP
      // above does not necessarily end Browserbase's own session
      // immediately. Wrapped separately so a failure here never masks the
      // stage's real result; could not be verified against a live
      // Browserbase account in this environment.
      try {
        await fetch(`${BROWSERBASE_SESSIONS_URL}/${sessionId}`, {
          method: 'POST',
          headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
        });
      } catch (err) {
        logError('browser_session_release_failed', err, { provider: 'browserbase', label, sessionId });
      }
      logInfo('browser_closed', { provider: 'browserbase', label, sessionId });
    },
  };
}

/**
 * launchBrowser — the one function discovery/index.js and
 * navigation_runner/index.js call instead of chromium.launch() directly.
 * @param {string} label - which caller, for logging only (e.g. 'Discovery').
 * @returns {Promise<{browser: import('playwright').Browser, close: () => Promise<void>}>}
 */
export async function launchBrowser(label) {
  const provider = (process.env.BROWSER_PROVIDER || 'local').trim().toLowerCase();
  if (provider === 'browserbase') return launchBrowserbase(label);
  if (provider === 'local') return launchLocal(label);
  throw new Error(`Unknown BROWSER_PROVIDER "${process.env.BROWSER_PROVIDER}". Expected "local" or "browserbase".`);
}
