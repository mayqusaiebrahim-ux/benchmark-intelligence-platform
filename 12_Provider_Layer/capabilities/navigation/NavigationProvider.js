/**
 * NavigationProvider — the contract for driving a browser against a live
 * product: navigation, probing for bot-walls, structural discovery,
 * single-screenshot capture, and multi-step journey execution.
 *
 * Five methods, not one collapsed contract. Four of them
 * (probe/discover/captureScreenshot/runJourney) are today's reality: four
 * separate Playwright entry points with different call shapes and purposes
 * (see PlaywrightNavigationProvider.js). navigate() is the fifth, added in
 * Sprint 19 specifically for the Runtime's Navigation Stage — a minimal,
 * analysis-free "reach this URL and report where you ended up" primitive
 * none of the other four provide (probe analyzes bot-walls, discover
 * analyzes page structure, captureScreenshot takes a screenshot, runJourney
 * needs a pre-built JourneyPlan). Collapsing the other four into navigate()
 * now would mean guessing at a contract the platform's Settings UI hasn't
 * defined yet; better to add the one new primitive actually needed.
 */
export class NavigationProvider {
  /** Bot-wall / protection probe. See modules/antibot/probe.js's probeUrl(). */
  async probe(url, opts) {
    throw new Error(`${this.constructor.name} must implement probe(url, opts)`);
  }

  /** Structural discovery of an unknown page. See modules/discovery/index.js's runDiscovery(). */
  async discover({ url, companySlug, companyName }) {
    throw new Error(`${this.constructor.name} must implement discover(input)`);
  }

  /** Single full-page screenshot. See modules/vision/screenshotRunner.js's captureScreenshot(). */
  async captureScreenshot({ company, url, requestId }) {
    throw new Error(`${this.constructor.name} must implement captureScreenshot(input)`);
  }

  /** Multi-step journey execution. See modules/navigation_runner/index.js's runJourney(). */
  async runJourney({ journeyPlan, companyName, companySlug }) {
    throw new Error(`${this.constructor.name} must implement runJourney(input)`);
  }

  /**
   * Navigation only: reach a URL, wait for it to stabilize, follow
   * redirects, report where you ended up. No analysis, no screenshot, no
   * report — see 13_Orchestrator/stages/navigationStage.js, the only
   * caller. Never throws; resolves { success, requestedUrl, url, title,
   * timing: { startedAt, finishedAt, durationMs }, error }.
   */
  async navigate(url, opts) {
    throw new Error(`${this.constructor.name} must implement navigate(url, opts)`);
  }
}
