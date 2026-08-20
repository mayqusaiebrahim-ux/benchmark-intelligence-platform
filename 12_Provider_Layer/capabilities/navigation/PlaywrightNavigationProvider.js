/**
 * PlaywrightNavigationProvider — the default (and, today, only) Navigation
 * provider. For four of its five methods, a pure facade: each delegates to
 * the existing, unmodified Playwright entry point in
 * 11_Benchmark_Engine/modules/ — no browser automation logic is
 * reimplemented here.
 *
 * navigate() (Sprint 19) is the one deliberate exception: real, new
 * Playwright code lives here because 11_Benchmark_Engine/ is explicitly
 * frozen (see its README) and this minimal "navigation only" primitive
 * doesn't exist anywhere in the Engine to delegate to — adding it there
 * would violate the freeze. Its launch/goto/networkidle idiom matches
 * modules/discovery/index.js and modules/vision/screenshotRunner.js's
 * existing style exactly; this isn't a new pattern, just the first time it
 * lives outside the Engine. See README.md and ../../package.json.
 *
 * Sprint 23 — Shared Browser Session: navigate()'s own chromium.launch()/
 * browser.newPage()/browser.close() calls now go through
 * BrowserSessionManager.js (this same folder) instead of calling Playwright
 * directly. This is the one launch site Navigation Stage owns, and the one
 * this sprint consolidated — see BrowserSessionManager.js's header for the
 * full audit of which other launch sites were deliberately left alone.
 */
import { NavigationProvider } from './NavigationProvider.js';
import { createBrowserSession, closeBrowserSession } from './BrowserSessionManager.js';
import { probeUrl } from '../../../11_Benchmark_Engine/modules/antibot/index.js';
import { runDiscovery } from '../../../11_Benchmark_Engine/modules/discovery/index.js';
import { captureScreenshot } from '../../../11_Benchmark_Engine/modules/vision/screenshotRunner.js';
import { runJourney } from '../../../11_Benchmark_Engine/modules/navigation_runner/index.js';

export class PlaywrightNavigationProvider extends NavigationProvider {
  probe(url, opts) {
    return probeUrl(url, opts);
  }

  discover(input) {
    return runDiscovery(input);
  }

  captureScreenshot(input) {
    return captureScreenshot(input);
  }

  runJourney(input) {
    return runJourney(input);
  }

  async navigate(url, opts = {}) {
    const startedAtMs = Date.now();
    const timing = () => ({
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
    });

    let browser;
    let keepBrowserOpen = false; // only ever flips true on the successful keepOpen return path below
    try {
      const session = await createBrowserSession();
      browser = session.browser;
      const page = session.page;

      await page.goto(url, { waitUntil: 'load', timeout: opts.timeout ?? 30000 });
      try {
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      } catch {
        // Some pages never go fully idle (analytics/websockets) — proceed with whatever loaded.
      }

      const result = {
        success: true,
        requestedUrl: url,
        url: page.url(),
        title: await page.title(),
        timing: timing(),
        error: null,
      };

      if (opts.keepOpen) {
        // Caller (Screenshot Stage, via Runtime's previousOutput threading —
        // see 13_Orchestrator/stages/screenshotStage.js) takes ownership of
        // this browser/page and is responsible for closing it. Default
        // behavior (opts.keepOpen absent/false) is completely unchanged.
        keepBrowserOpen = true;
        return { ...result, page, browser };
      }

      return result;
    } catch (err) {
      return {
        success: false,
        requestedUrl: url,
        url: null,
        title: null,
        timing: timing(),
        error: err.message,
      };
    } finally {
      if (!keepBrowserOpen) await closeBrowserSession(browser);
    }
  }
}
