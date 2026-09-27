#!/usr/bin/env node
/**
 * Conditional Chromium install for deployment.
 *
 * 11_Benchmark_Engine's Feature Benchmark (Discovery, Navigation Runner) now
 * goes through modules/browserLauncher.js, which never calls
 * chromium.launch() when BROWSER_PROVIDER=browserbase — so downloading a
 * local Chromium for 11_Benchmark_Engine in that mode is pure wasted
 * build time and disk space on Render.
 *
 * 12_Provider_Layer's Full Pipeline (BrowserSessionManager.js) is a
 * separate, unmodified chromium.launch() site untouched by this change — it
 * still needs a local Chromium regardless of BROWSER_PROVIDER, so its
 * install is never skipped here.
 *
 * Both named browsers, explicitly: playwright-core 1.61.1 (see
 * node_modules/playwright-core/browsers.json) lists "chromium" and
 * "chromium-headless-shell" as two SEPARATE downloadable revisions.
 * chromium.launch() with no explicit `headless` option (every call site in
 * this repo) launches in Playwright's default headless mode, which uses the
 * chromium-headless-shell binary, not the regular "chromium" one. Passing
 * both names explicitly is the same thing `playwright install chromium`
 * does implicitly today (its own --help documents installing the shell
 * alongside chromium unless --no-shell is passed) — spelled out here so the
 * build stays correct and self-documenting even if that implicit default
 * ever changes in a future Playwright release, without depending on it.
 *
 * Idempotent: playwright install skips a browser revision that is already
 * present, so re-running this (e.g. from startCommand, not just
 * buildCommand — see render.yaml) is cheap and safe.
 *
 * Plain Node.js (not a shell conditional) so this runs identically on
 * Windows and Linux/Render.
 */
import { execSync } from 'child_process';

const useBrowserbase = (process.env.BROWSER_PROVIDER || '').trim().toLowerCase() === 'browserbase';
const BROWSERS = 'chromium chromium-headless-shell';

if (useBrowserbase) {
  console.log('[install:browsers] BROWSER_PROVIDER=browserbase — skipping 11_Benchmark_Engine Chromium download.');
} else {
  console.log('[install:browsers] Installing local Chromium (+ headless shell) for 11_Benchmark_Engine...');
  execSync(`npx --prefix 11_Benchmark_Engine playwright install ${BROWSERS}`, { stdio: 'inherit' });
}

console.log('[install:browsers] Installing local Chromium (+ headless shell) for 12_Provider_Layer (Full Pipeline, unaffected by BROWSER_PROVIDER)...');
execSync(`npx --prefix 12_Provider_Layer playwright install ${BROWSERS}`, { stdio: 'inherit' });
