/**
 * BrowserSessionManager — Sprint 23: the one place `chromium.launch()` is
 * called from application code reached through the Runtime (Navigation
 * Stage → Screenshot Stage). Consolidates browser creation, and closing,
 * into a single shared pair of functions so a Runtime-driven session is
 * created and torn down the same way every time, instead of that logic
 * living inline in each caller.
 *
 * Scope, precisely: this replaces the ONE inline `chromium.launch()` that
 * lived in PlaywrightNavigationProvider.navigate() (the Navigation Stage's
 * own browser-creation call), and the browser.close() calls around it and
 * around Screenshot Stage's reuse of that same session. It does NOT touch
 * Discovery's, the Anti-Bot probe's, or the orphaned single-shot
 * screenshotRunner.js's own independent chromium.launch() calls — those are
 * deliberately left alone this sprint. See this repo's Sprint 23 report for
 * the full reasoning (the Anti-Bot probe's multiple launches are its actual
 * job — each fallback strategy needs its own differently-configured
 * browser — and Discovery's separate navigation after the probe is a
 * documented, production-tested safety check, not an accidental duplicate).
 */
import { chromium } from 'playwright';

/**
 * Launches one Chromium instance and opens one page on it. The one function
 * that should call chromium.launch() for a Runtime-driven browser session.
 * @returns {Promise<{browser: import('playwright').Browser, page: import('playwright').Page}>}
 */
export async function createBrowserSession() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  return { browser, page };
}

/**
 * Closes a browser session. Symmetric counterpart to createBrowserSession()
 * — the one place browser.close() is called for a Runtime-driven session.
 * Safe to call with a falsy/already-closed browser (no-op).
 * @param {import('playwright').Browser} browser
 */
export async function closeBrowserSession(browser) {
  if (browser) await browser.close();
}
