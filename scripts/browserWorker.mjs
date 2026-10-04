#!/usr/bin/env node
/**
 * scripts/browserWorker.mjs — the BROWSER WORKER for BROWSER_PROVIDER=remote.
 *
 * Runs the benchmark's Chromium on THIS machine (so its ~1 GB never counts
 * against the 512 MB Render service) and exposes it to the Render app over the
 * Chrome DevTools Protocol through a small token-checking proxy:
 *
 *   Render ──wss──► tunnel ──► 127.0.0.1:<BROWSER_WORKER_PORT>/cdp (this proxy,
 *   requires x-browser-worker-token) ──► 127.0.0.1:<CDP port> (Chromium)
 *
 * - Chromium: the installed Playwright Chromium 149, the SAME launch flags and
 *   user-agent profile as production (imported from browserLauncher.js), new
 *   headless mode, a throwaway profile directory deleted on exit — no personal
 *   profile, cookies or logins.
 * - Chrome's debugging port binds to 127.0.0.1 only and is never exposed; only
 *   the proxy is, and it forwards ONLY authenticated WebSocket upgrades on /cdp.
 * - GET /health returns "ok" (no details) so the tunnel can be checked.
 *
 * RUN (from the project root):
 *   BROWSER_WORKER_TOKEN=<long random secret> node scripts/browserWorker.mjs
 * then expose the proxy with a tunnel, e.g.:
 *   cloudflared tunnel --url http://127.0.0.1:9333
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, timingSafeEqual } from 'node:crypto';
import { LOCAL_LAUNCH_ARGS, buildPageProfile } from '../11_Benchmark_Engine/modules/browserLauncher.js';
import { REMOTE_TOKEN_HEADER } from '../11_Benchmark_Engine/modules/remoteBrowserConfig.js';

export const MIN_TOKEN_LENGTH = 32;
export const DEFAULT_PROXY_PORT = 9333;
export const DEFAULT_CDP_PORT = 9222;
const LOOPBACK = '127.0.0.1';

/** Validate the worker's environment. Never throws. */
export function parseWorkerConfig(env = process.env) {
  const token = (env.BROWSER_WORKER_TOKEN || '').trim();
  const proxyPort = Number(env.BROWSER_WORKER_PORT || DEFAULT_PROXY_PORT);
  const cdpPort = Number(env.BROWSER_WORKER_CDP_PORT || DEFAULT_CDP_PORT);
  const fail = (error) => ({ ok: false, error });
  if (!token) return fail('BROWSER_WORKER_TOKEN is required (the same value as REMOTE_BROWSER_TOKEN on Render).');
  if (token.length < MIN_TOKEN_LENGTH) return fail(`BROWSER_WORKER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters.`);
  for (const [name, p] of [['BROWSER_WORKER_PORT', proxyPort], ['BROWSER_WORKER_CDP_PORT', cdpPort]]) {
    if (!Number.isInteger(p) || p < 1024 || p > 65535) return fail(`${name} must be a port between 1024 and 65535.`);
  }
  if (proxyPort === cdpPort) return fail('BROWSER_WORKER_PORT and BROWSER_WORKER_CDP_PORT must differ.');
  return { ok: true, token, proxyPort, cdpPort, error: null };
}

/** Chromium arguments: production flags + new headless + loopback-only CDP + throwaway profile. */
export function buildChromeArgs({ cdpPort, userDataDir, userAgent }) {
  return [
    ...LOCAL_LAUNCH_ARGS,
    // Same as production: Playwright's chromium.launch() always adds
    // --no-sandbox. Launched directly, Chromium's Windows sandbox cannot
    // access the Playwright Chromium folder ("Sandbox cannot access
    // executable … Access is denied"), which destabilises startup.
    '--no-sandbox',
    '--headless=new',
    `--remote-debugging-address=${LOOPBACK}`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--user-agent=${userAgent}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--password-store=basic',
    '--use-mock-keychain',
    'about:blank',
  ];
}

/** Constant-time token check (hash both sides so lengths never leak). */
export function isAuthorized(provided, token) {
  if (typeof provided !== 'string' || !provided || !token) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

/** The upgrade request forwarded to Chromium: token/origin removed, Host pinned to loopback. */
export function buildUpstreamRequest(rawHeaders, wsPath, cdpPort) {
  const drop = new Set(['host', 'origin', REMOTE_TOKEN_HEADER, 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip']);
  const lines = [`GET ${wsPath} HTTP/1.1`, `Host: ${LOOPBACK}:${cdpPort}`];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    if (drop.has(name.toLowerCase()) || name.toLowerCase().startsWith('cf-')) continue;
    lines.push(`${name}: ${rawHeaders[i + 1]}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

async function browserWsPath(cdpHost, cdpPort) {
  const resp = await fetch(`http://${cdpHost}:${cdpPort}/json/version`);
  if (!resp.ok) throw new Error(`CDP /json/version returned HTTP ${resp.status}`);
  const { webSocketDebuggerUrl } = await resp.json();
  return new URL(webSocketDebuggerUrl).pathname; // /devtools/browser/<id>
}

function reject(socket, status, text) {
  try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* ignore */ }
  socket.destroy();
}

/**
 * The /cdp proxy. Only authenticated WebSocket upgrades on /cdp are forwarded;
 * everything else is 401/404. Chrome's own port is only ever dialled on loopback.
 */
export function createWorkerProxy({ token, cdpHost = LOOPBACK, cdpPort, log = () => {} }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
    res.writeHead(404); res.end();
  });
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    const path = String(req.url || '').split('?')[0];
    if (path !== '/cdp') return reject(socket, 404, 'Not Found');
    if (!isAuthorized(req.headers[REMOTE_TOKEN_HEADER], token)) {
      log('rejected unauthenticated /cdp connection');
      return reject(socket, 401, 'Unauthorized');
    }
    let wsPath;
    try { wsPath = await browserWsPath(cdpHost, cdpPort); }
    catch (err) { log(`browser endpoint unavailable: ${err.message}`); return reject(socket, 502, 'Bad Gateway'); }
    const upstream = net.connect(cdpPort, cdpHost, () => {
      upstream.write(buildUpstreamRequest(req.rawHeaders, wsPath, cdpPort));
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      log('authenticated /cdp session opened');
    });
    const closeBoth = () => { socket.destroy(); upstream.destroy(); };
    upstream.on('error', closeBoth);
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  return server;
}

/** Version of the bundled Chromium, from playwright-core's browsers.json (not an exported subpath — read from disk). */
export function chromiumVersion() {
  const require = createRequire(resolve(fileURLToPath(new URL('../11_Benchmark_Engine/package.json', import.meta.url))));
  const file = join(dirname(require.resolve('playwright-core')), 'browsers.json');
  const { browsers } = JSON.parse(readFileSync(file, 'utf8'));
  return (browsers.find((b) => b.name === 'chromium') || {}).browserVersion;
}

function chromiumExecutable() {
  if (process.env.BROWSER_WORKER_CHROME_PATH) return process.env.BROWSER_WORKER_CHROME_PATH;
  const require = createRequire(resolve(fileURLToPath(new URL('../11_Benchmark_Engine/package.json', import.meta.url))));
  return require('playwright').chromium.executablePath(); // full Chromium, not the headless shell
}

/** True when something is already listening on 127.0.0.1:<port>. */
export function isPortInUse(port, host = LOOPBACK, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    const done = (inUse) => { try { s.destroy(); } catch { /* ignore */ } resolve(inUse); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function waitForCdp(cdpPort, { timeoutMs = 20000, hasExited = () => false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasExited()) throw new Error('Chromium exited before opening its debugging port');
    try { await browserWsPath(LOOPBACK, cdpPort); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`Chromium did not open its debugging port ${cdpPort} within ${timeoutMs}ms`);
}

async function main() {
  const cfg = parseWorkerConfig(process.env);
  if (!cfg.ok) { console.error(`✖ ${cfg.error}`); process.exit(1); }
  const exe = chromiumExecutable();
  if (!exe || !existsSync(exe)) { console.error(`✖ Chromium not found at "${exe}". Run: npm install --prefix 11_Benchmark_Engine`); process.exit(1); }
  // Pre-flight: never start (or proxy to) a browser we did not launch. On
  // Windows, closing the terminal does not kill the Chromium a previous
  // worker spawned — an orphan holding the port is the usual cause of
  // "did not open its debugging port".
  for (const [name, port] of [['BROWSER_WORKER_CDP_PORT', cfg.cdpPort], ['BROWSER_WORKER_PORT', cfg.proxyPort]]) {
    if (await isPortInUse(port)) {
      console.error(`✖ Port ${port} (${name}) is already in use on ${LOOPBACK} — most likely a Chromium or worker left running from an earlier run.`);
      console.error('  Close it (e.g. Task Manager → end the leftover "chrome.exe" from ms-playwright), or choose another port via that variable.');
      process.exit(1);
    }
  }

  const version = chromiumVersion();
  const userAgent = buildPageProfile(version).userAgent; // same builder as production, this machine's platform
  const userDataDir = mkdtempSync(join(tmpdir(), 'bench-worker-profile-'));

  const chrome = spawn(exe, buildChromeArgs({ cdpPort: cfg.cdpPort, userDataDir, userAgent }), { stdio: ['ignore', 'ignore', 'pipe'] });
  // Keep Chromium's last stderr lines so a startup failure says WHY.
  const chromeLog = [];
  chrome.stderr.on('data', (d) => {
    for (const line of d.toString().split(/\r?\n/)) if (line.trim()) chromeLog.push(line.trim().slice(0, 300));
    if (chromeLog.length > 20) chromeLog.splice(0, chromeLog.length - 20);
  });
  let chromeExited = false;
  const printChromeLog = () => { if (chromeLog.length) console.error(`  Chromium output (last lines):\n    ${chromeLog.slice(-6).join('\n    ')}`); };
  let proxy = null;
  let stopping = false;
  const shutdown = (code) => {
    if (stopping) return;
    stopping = true;
    try { proxy && proxy.close(); } catch { /* ignore */ }
    try { chrome.kill(); } catch { /* ignore */ }
    setTimeout(() => { try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(code); }, 1000);
  };
  chrome.on('exit', (c) => {
    chromeExited = true;
    if (!stopping) { console.error(`✖ Chromium exited (code ${c}) — worker stopping.`); printChromeLog(); shutdown(1); }
  });
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  try { await waitForCdp(cfg.cdpPort, { hasExited: () => chromeExited }); }
  catch (err) { console.error(`✖ ${err.message}`); printChromeLog(); shutdown(1); return; }
  proxy = createWorkerProxy({ token: cfg.token, cdpPort: cfg.cdpPort, log: (m) => console.log(`[worker] ${m}`) });
  proxy.listen(cfg.proxyPort, LOOPBACK, () => {
    console.log(`✓ Browser worker ready — Chromium ${version}, throwaway profile ${userDataDir}`);
    console.log(`  Proxy: http://${LOOPBACK}:${cfg.proxyPort}  (WebSocket endpoint /cdp, header ${REMOTE_TOKEN_HEADER})`);
    console.log(`  Chrome debugging port ${cfg.cdpPort} is bound to ${LOOPBACK} only and is NOT exposed.`);
    console.log(`  Next: cloudflared tunnel --url http://${LOOPBACK}:${cfg.proxyPort}`);
    console.log('  Ctrl+C stops Chromium and deletes the profile.');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
