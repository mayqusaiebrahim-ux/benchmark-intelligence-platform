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
 * Plain Node.js (not a shell conditional) so this runs identically on
 * Windows and Linux/Render.
 */
import { execSync } from 'child_process';

const useBrowserbase = (process.env.BROWSER_PROVIDER || '').trim().toLowerCase() === 'browserbase';

if (useBrowserbase) {
  console.log('[install:browsers] BROWSER_PROVIDER=browserbase — skipping 11_Benchmark_Engine Chromium download.');
} else {
  console.log('[install:browsers] Installing local Chromium for 11_Benchmark_Engine...');
  execSync('npx --prefix 11_Benchmark_Engine playwright install chromium', { stdio: 'inherit' });
}

console.log('[install:browsers] Installing local Chromium for 12_Provider_Layer (Full Pipeline, unaffected by BROWSER_PROVIDER)...');
execSync('npx --prefix 12_Provider_Layer playwright install chromium', { stdio: 'inherit' });
