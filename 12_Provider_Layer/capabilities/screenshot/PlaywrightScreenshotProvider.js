/**
 * PlaywrightScreenshotProvider — the default (and, today, only) Screenshot
 * provider. Reuses the SAME page/browser Navigation already opened — no
 * chromium.launch(), no page.goto() here, ever. It is the sole owner of
 * closing that session once capture is done (success or failure), matching
 * navigate()'s "one Provider method, one finally that owns the browser"
 * shape from PlaywrightNavigationProvider.js.
 *
 * Sprint 23 — Shared Browser Session: the closing browser.close() call now
 * goes through BrowserSessionManager.js's closeBrowserSession() — the same
 * shared close function PlaywrightNavigationProvider.js uses on its own
 * failure path — rather than calling browser.close() directly. No behavior
 * change; this is the symmetric close-side counterpart to Navigation
 * Stage's create-side consolidation. See BrowserSessionManager.js's header.
 *
 * Storage: reuses 11_Benchmark_Engine/modules/vision/screenshotRunner.js's
 * already-exported SCREENSHOTS_DIR (03_Screenshots/, flat) — the only
 * currently-live, code-driven single-shot screenshot convention in this
 * codebase (see README.md). slugify()/timestampForFilename() are NOT
 * exported from that frozen file, so tiny equivalents are reimplemented
 * here, matching the exact same idiom, rather than touching the Engine.
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { ScreenshotProvider } from './ScreenshotProvider.js';
import { SCREENSHOTS_DIR } from '../../../11_Benchmark_Engine/modules/vision/screenshotRunner.js';
import { closeBrowserSession } from '../navigation/BrowserSessionManager.js';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class PlaywrightScreenshotProvider extends ScreenshotProvider {
  async capture({ page, browser, companySlug }) {
    const startedAtMs = Date.now();
    const timing = () => ({
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
    });

    const slug = slugify(companySlug || 'unknown');
    const stamp = timestampForFilename(); // same stamp for both files — keeps the pair visually associated
    const viewportPath = join(SCREENSHOTS_DIR, `${slug}_${stamp}_viewport.png`);
    const fullPagePath = join(SCREENSHOTS_DIR, `${slug}_${stamp}_fullpage.png`);

    try {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });

      const viewportSize = page.viewportSize(); // {width,height} of the already-open page's viewport
      await page.screenshot({ path: viewportPath, fullPage: false });

      const { width: fullPageWidth, height: fullPageHeight } = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }));
      await page.screenshot({ path: fullPagePath, fullPage: true });

      return {
        success: true,
        screenshots: {
          viewport: { path: viewportPath, width: viewportSize?.width ?? null, height: viewportSize?.height ?? null },
          fullPage: { path: fullPagePath, width: fullPageWidth, height: fullPageHeight },
        },
        timing: timing(),
        error: null,
      };
    } catch (err) {
      return {
        success: false,
        screenshots: null,
        timing: timing(),
        error: err.message,
      };
    } finally {
      await closeBrowserSession(browser); // Screenshot Stage is the last consumer of the live session — always closes here.
    }
  }
}
