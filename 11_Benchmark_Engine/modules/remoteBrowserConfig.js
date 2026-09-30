/**
 * remoteBrowserConfig — settings for BROWSER_PROVIDER=remote: a Chromium
 * running on a separate "browser worker" machine (scripts/browserWorker.mjs),
 * reached over the Chrome DevTools Protocol through the worker's
 * token-checking /cdp proxy. Dependency-free so browserLauncher.js and the
 * autonomous navigator can both use it.
 */

/** Header the worker's /cdp proxy requires on the WebSocket upgrade. */
export const REMOTE_TOKEN_HEADER = 'x-browser-worker-token';

export function isRemoteProvider(env = process.env) {
  return (env.BROWSER_PROVIDER || 'local').trim().toLowerCase() === 'remote';
}

/**
 * Read + validate the remote-browser settings. Never throws.
 * @returns {{ ok: boolean, url: string|null, token: string|null, headers: object|null, error: string|null }}
 */
export function readRemoteBrowserConfig(env = process.env) {
  const url = (env.REMOTE_BROWSER_CDP_URL || '').trim();
  const token = (env.REMOTE_BROWSER_TOKEN || '').trim();
  const fail = (error) => ({ ok: false, url: url || null, token: null, headers: null, error });
  if (!url) return fail('BROWSER_PROVIDER=remote requires REMOTE_BROWSER_CDP_URL (the worker\'s wss://…/cdp endpoint).');
  if (!/^wss?:\/\//i.test(url)) return fail(`REMOTE_BROWSER_CDP_URL must be a ws:// or wss:// URL (got "${url.split('?')[0]}").`);
  if (!token) return fail('BROWSER_PROVIDER=remote requires REMOTE_BROWSER_TOKEN (sent as the x-browser-worker-token header).');
  return { ok: true, url, token, headers: { [REMOTE_TOKEN_HEADER]: token }, error: null };
}
