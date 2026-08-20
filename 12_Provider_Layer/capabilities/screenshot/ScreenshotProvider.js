/**
 * ScreenshotProvider — the contract for capturing full-page and viewport
 * screenshots from an ALREADY-OPEN Playwright session handed off by the
 * Navigation stage. This capability never launches its own browser and
 * never navigates — that would duplicate work Navigation already did and
 * violate Sprint 20's "browser must not relaunch, navigation must not
 * happen twice" requirement. It receives a live page/browser and its job
 * ends the moment it has produced two image files and closed that session.
 */
export class ScreenshotProvider {
  /**
   * @param {object} input
   * @param {import('playwright').Page} input.page       - live page from Navigation, already loaded.
   * @param {import('playwright').Browser} input.browser  - the same browser Navigation launched; this
   *                                                         provider is responsible for closing it.
   * @param {string} [input.companySlug]
   * @returns {Promise<object>} { success, screenshots: { fullPage, viewport } | null, timing, error }
   *   fullPage/viewport shape: { path, width, height }
   */
  async capture(input) {
    throw new Error(`${this.constructor.name} must implement capture(input)`);
  }
}
