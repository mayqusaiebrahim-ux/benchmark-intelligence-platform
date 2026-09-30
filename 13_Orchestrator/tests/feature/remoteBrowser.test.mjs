/**
 * BROWSER_PROVIDER=remote — offline tests. Playwright is mocked (no browser),
 * and the worker-proxy tests use loopback-only servers on random ports (no
 * internet). Nothing here launches Chromium or makes a model call.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOKEN = 'test-worker-token-0123456789abcdef-XYZ';
const WSS = 'wss://worker.example.test/cdp';

// ─── mocked Playwright: records connect/launch calls ───────────────────────
const pw = { connects: [], launches: 0, connectBehavior: 'ok' };
function fakeRemoteBrowser() {
  return {
    closed: 0,
    version: () => '149.0.7827.55',
    async newBrowserCDPSession() {
      return {
        async send(method) {
          assert.equal(method, 'Browser.getVersion');
          return { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36' };
        },
        async detach() {},
      };
    },
    on() {}, once() {},
    async close() { this.closed += 1; },
  };
}
mock.module(pathToFileURL(join(ROOT, '11_Benchmark_Engine', 'node_modules', 'playwright', 'index.mjs')).href, {
  namedExports: {
    chromium: {
      async connectOverCDP(url, opts) {
        pw.connects.push({ url, opts });
        if (pw.connectBehavior === 'fail') throw new Error('browserType.connectOverCDP: WebSocket error: 401 Unauthorized');
        return fakeRemoteBrowser();
      },
      async launch() { pw.launches += 1; throw new Error('a local Chromium must NEVER be launched in remote mode'); },
      executablePath: () => '/nonexistent/chrome',
    },
  },
});

const { readRemoteBrowserConfig, REMOTE_TOKEN_HEADER, isRemoteProvider } =
  await import('../../../11_Benchmark_Engine/modules/remoteBrowserConfig.js');
const { launchBrowser, launchRemote, REMOTE_CONNECT_TIMEOUT_MS, LOCAL_LAUNCH_ARGS } =
  await import('../../../11_Benchmark_Engine/modules/browserLauncher.js');
const NAV = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/autonomousNavigator.js');
const W = await import('../../../scripts/browserWorker.mjs');

function withEnv(t, vars) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  t.after(() => { for (const k of Object.keys(saved)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } });
}
const REMOTE_ENV = { BROWSER_PROVIDER: 'remote', REMOTE_BROWSER_CDP_URL: WSS, REMOTE_BROWSER_TOKEN: TOKEN };

// ─── config ────────────────────────────────────────────────────────────────
test('provider selection: remote is recognised; local stays the default', () => {
  assert.equal(isRemoteProvider({ BROWSER_PROVIDER: 'remote' }), true);
  assert.equal(isRemoteProvider({ BROWSER_PROVIDER: ' Remote ' }), true);
  assert.equal(isRemoteProvider({}), false);
  assert.equal(isRemoteProvider({ BROWSER_PROVIDER: 'local' }), false);
});

test('remote config: URL + token header; missing/invalid values rejected with a clear error', () => {
  const ok = readRemoteBrowserConfig({ REMOTE_BROWSER_CDP_URL: WSS, REMOTE_BROWSER_TOKEN: TOKEN });
  assert.equal(ok.ok, true);
  assert.equal(ok.url, WSS);
  assert.deepEqual(ok.headers, { 'x-browser-worker-token': TOKEN });
  assert.equal(REMOTE_TOKEN_HEADER, 'x-browser-worker-token');
  assert.match(readRemoteBrowserConfig({ REMOTE_BROWSER_TOKEN: TOKEN }).error, /REMOTE_BROWSER_CDP_URL/);
  assert.match(readRemoteBrowserConfig({ REMOTE_BROWSER_CDP_URL: 'https://x.test/cdp', REMOTE_BROWSER_TOKEN: TOKEN }).error, /ws:\/\/ or wss:\/\//);
  assert.match(readRemoteBrowserConfig({ REMOTE_BROWSER_CDP_URL: WSS }).error, /REMOTE_BROWSER_TOKEN/);
});

// ─── launchRemote / launchBrowser ──────────────────────────────────────────
test('remote connect: REMOTE_BROWSER_CDP_URL + x-browser-worker-token header + bounded timeout; same session shape', async () => {
  const calls = [];
  const s = await launchRemote('T', { env: REMOTE_ENV, connect: async (url, opts) => { calls.push({ url, opts }); return fakeRemoteBrowser(); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WSS);
  assert.deepEqual(calls[0].opts.headers, { 'x-browser-worker-token': TOKEN });
  assert.equal(calls[0].opts.timeout, REMOTE_CONNECT_TIMEOUT_MS);
  assert.equal(typeof s.close, 'function');
  assert.ok(s.browser);
  assert.deepEqual(s.pageOptions.viewport, { width: 1440, height: 900 });
  assert.equal(s.pageOptions.locale, 'en-US');
  assert.equal(s.pageOptions.userAgent, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36', 'worker platform kept, HeadlessChrome removed');
  await s.close();
  assert.equal(s.browser.closed, 1, 'close() disconnects (clears our contexts) — never a local teardown');
});

test('missing token → fails immediately, never connects', async () => {
  let connected = false;
  await assert.rejects(
    launchRemote('T', { env: { BROWSER_PROVIDER: 'remote', REMOTE_BROWSER_CDP_URL: WSS }, connect: async () => { connected = true; } }),
    /REMOTE_BROWSER_TOKEN/,
  );
  assert.equal(connected, false);
});

test('invalid token (worker rejects the upgrade) → clear "unavailable" error that never contains the token', async () => {
  const err = await launchRemote('T', { env: REMOTE_ENV, connect: async () => { throw new Error('WebSocket error: 401 Unauthorized'); } }).catch((e) => e);
  assert.match(err.message, /Remote browser worker unavailable at worker\.example\.test/);
  assert.match(err.message, /401 Unauthorized/);
  assert.ok(!err.message.includes(TOKEN), 'the token is never in the error');
});

test('launchBrowser(remote): uses connectOverCDP; on failure NO silent local fallback, and the browser slot is released', async (t) => {
  withEnv(t, REMOTE_ENV);
  pw.connects.length = 0; pw.launches = 0;
  pw.connectBehavior = 'ok';
  const s = await launchBrowser('Discovery');
  assert.equal(pw.connects.length, 1);
  assert.equal(pw.connects[0].url, WSS);
  assert.deepEqual(pw.connects[0].opts.headers, { 'x-browser-worker-token': TOKEN });
  await s.close();

  pw.connectBehavior = 'fail';
  const guard = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('launchBrowser hung — browser slot leaked')), 2000))]);
  await assert.rejects(guard(launchBrowser('Discovery')), /Remote browser worker unavailable/);
  await assert.rejects(guard(launchBrowser('Navigation Runner')), /Remote browser worker unavailable/, 'second call proves the slot was released');
  assert.equal(pw.launches, 0, 'a local Chromium was never launched');
  pw.connectBehavior = 'ok';
});

test('launchBrowser: an unknown provider is still rejected', async (t) => {
  withEnv(t, { BROWSER_PROVIDER: 'nope' });
  await assert.rejects(launchBrowser('X'), /Expected "local", "remote" or "browserbase"/);
});

// ─── Stagehand (autonomous navigator) ──────────────────────────────────────
test('Stagehand remote: attaches via cdpUrl + cdpHeaders, keeps its 1288x711 viewport, launches nothing', (t) => {
  withEnv(t, { ...REMOTE_ENV, OPENAI_API_KEY: 'sk-offline-test-invalid', AGENT_NAV_MODEL: null, BROWSERBASE_API_KEY: null });
  const o = NAV.buildStagehandConstructorOptions();
  assert.equal(o.env, 'LOCAL');
  assert.deepEqual(o.localBrowserLaunchOptions, {
    cdpUrl: WSS,
    cdpHeaders: { 'x-browser-worker-token': TOKEN },
    viewport: { width: 1288, height: 711 },
  });
  assert.equal('headless' in o.localBrowserLaunchOptions, false);
  assert.equal(o.model, 'openai/gpt-5.6-luna', 'agent model/behaviour unchanged');
  const cfg = NAV.validateAgentConfiguration();
  assert.equal(cfg.ok, true);
  assert.equal(cfg.browser, 'remote');
});

test('Stagehand remote without a token → agent configuration rejected before any session', (t) => {
  withEnv(t, { BROWSER_PROVIDER: 'remote', REMOTE_BROWSER_CDP_URL: WSS, REMOTE_BROWSER_TOKEN: null, OPENAI_API_KEY: 'sk-offline-test-invalid' });
  const cfg = NAV.validateAgentConfiguration();
  assert.equal(cfg.ok, false);
  assert.match(cfg.reason, /REMOTE_BROWSER_TOKEN/);
});

test('Stagehand local mode is unchanged (headless + existing args)', (t) => {
  withEnv(t, { BROWSER_PROVIDER: 'local', BROWSERBASE_API_KEY: null });
  assert.deepEqual(NAV.buildStagehandConstructorOptions().localBrowserLaunchOptions,
    { headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
});

// ─── browser worker ────────────────────────────────────────────────────────
test('worker config: token required (≥32 chars), ports validated and distinct', () => {
  assert.match(W.parseWorkerConfig({}).error, /BROWSER_WORKER_TOKEN is required/);
  assert.match(W.parseWorkerConfig({ BROWSER_WORKER_TOKEN: 'short' }).error, /at least 32/);
  assert.match(W.parseWorkerConfig({ BROWSER_WORKER_TOKEN: TOKEN, BROWSER_WORKER_PORT: '80' }).error, /between 1024/);
  assert.match(W.parseWorkerConfig({ BROWSER_WORKER_TOKEN: TOKEN, BROWSER_WORKER_PORT: '9222' }).error, /must differ/);
  assert.deepEqual(W.parseWorkerConfig({ BROWSER_WORKER_TOKEN: TOKEN }), { ok: true, token: TOKEN, proxyPort: 9333, cdpPort: 9222, error: null });
});

test('worker Chromium args: production flags, new headless, CDP bound to 127.0.0.1 only, throwaway profile, Chrome UA', () => {
  const args = W.buildChromeArgs({ cdpPort: 9222, userDataDir: '/tmp/bench-worker-profile-abc', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36' });
  for (const a of LOCAL_LAUNCH_ARGS) assert.ok(args.includes(a), `production flag ${a}`);
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'));
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=9222'));
  assert.ok(args.includes('--user-data-dir=/tmp/bench-worker-profile-abc'));
  assert.ok(!args.some((a) => a.includes('0.0.0.0')), 'never binds all interfaces');
  assert.ok(!args.some((a) => /HeadlessChrome/.test(a)));
  assert.ok(!args.some((a) => /--profile-directory|Default\b/.test(a)), 'no personal profile');
});

test('worker resolves the bundled Chromium version from playwright-core (not an exported subpath)', () => {
  assert.match(W.chromiumVersion(), /^\d+\.\d+\.\d+\.\d+$/);
});

test('worker auth: exact token only', () => {
  assert.equal(W.isAuthorized(TOKEN, TOKEN), true);
  assert.equal(W.isAuthorized(undefined, TOKEN), false);
  assert.equal(W.isAuthorized('', TOKEN), false);
  assert.equal(W.isAuthorized(`${TOKEN}x`, TOKEN), false);
  assert.equal(W.isAuthorized('wrong', TOKEN), false);
});

test('worker upstream request: token/origin/host/cf headers removed, Host pinned to loopback, browser path used', () => {
  const raw = ['Host', 'worker.example.test', 'Upgrade', 'websocket', 'Connection', 'Upgrade', 'Sec-WebSocket-Key', 'abc==', 'Sec-WebSocket-Version', '13',
    'x-browser-worker-token', TOKEN, 'Origin', 'https://evil.test', 'CF-Connecting-IP', '1.2.3.4'];
  const reqText = W.buildUpstreamRequest(raw, '/devtools/browser/xyz', 9222);
  assert.match(reqText, /^GET \/devtools\/browser\/xyz HTTP\/1\.1\r\nHost: 127\.0\.0\.1:9222\r\n/);
  assert.ok(!reqText.includes(TOKEN));
  assert.ok(!/origin:/i.test(reqText));
  assert.ok(!/worker\.example\.test/.test(reqText));
  assert.ok(!/cf-connecting-ip/i.test(reqText));
  assert.match(reqText, /Sec-WebSocket-Key: abc==/);
});

// Loopback integration: fake CDP upstream + the real proxy, both on 127.0.0.1:0.
function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
function upgradeTo(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => {
      const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
      s.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let buf = '';
    s.on('data', (d) => { buf += d.toString(); if (buf.includes('\r\n')) { s.destroy(); resolve(buf.split('\r\n')[0]); } });
    s.on('error', reject);
    setTimeout(() => { s.destroy(); resolve(buf.split('\r\n')[0] || '(no response)'); }, 2000);
  });
}

test('worker proxy (loopback only): /health ok; /cdp without or with a wrong token → 401; valid token → forwarded to the browser endpoint', async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${upstream.address().port}/devtools/browser/abc123` }));
      return;
    }
    res.writeHead(404); res.end();
  });
  upstream.on('upgrade', (req, socket) => {
    seen.push({ url: req.url, headers: req.headers });
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  const cdpPort = await listen(upstream);
  const proxy = W.createWorkerProxy({ token: TOKEN, cdpPort });
  const proxyPort = await listen(proxy);
  t.after(() => { proxy.close(); upstream.close(); });

  const health = await fetch(`http://127.0.0.1:${proxyPort}/health`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  assert.equal((await fetch(`http://127.0.0.1:${proxyPort}/json/version`)).status, 404, 'CDP HTTP endpoints are never exposed');

  assert.match(await upgradeTo(proxyPort, '/cdp'), /^HTTP\/1\.1 401/);
  assert.match(await upgradeTo(proxyPort, '/cdp', { 'x-browser-worker-token': 'wrong-token' }), /^HTTP\/1\.1 401/);
  assert.match(await upgradeTo(proxyPort, '/devtools/browser/abc123', { 'x-browser-worker-token': TOKEN }), /^HTTP\/1\.1 404/, 'only /cdp is proxied');
  assert.equal(seen.length, 0, 'nothing reached the browser without a valid token on /cdp');

  assert.match(await upgradeTo(proxyPort, '/cdp', { 'x-browser-worker-token': TOKEN, Origin: 'https://evil.test' }), /^HTTP\/1\.1 101/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/devtools/browser/abc123');
  assert.equal(seen[0].headers['x-browser-worker-token'], undefined, 'token never forwarded to Chromium');
  assert.equal(seen[0].headers.origin, undefined);
  assert.equal(seen[0].headers.host, `127.0.0.1:${cdpPort}`);
});
