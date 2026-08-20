/**
 * VisionProvider — the contract for any AI backend capable of turning a
 * homepage screenshot + Discovery Report into a structured, qualitative
 * UX read (see 11_Benchmark_Engine/contracts/vision_ux_analysis.schema.json).
 *
 * Throws on failure rather than degrading internally — callers that need
 * graceful degradation (e.g. 11_Benchmark_Engine/modules/reports/
 * homepageReport.js's runVisionAnalysis(), which must not let a Vision
 * failure block the rest of the report) already own that try/catch
 * themselves; a provider's job is only to succeed or throw.
 */
export class VisionProvider {
  /**
   * @param {object} input
   * @param {string} input.screenshotPath   - path to the homepage screenshot on disk.
   * @param {object} input.discoveryReport  - Discovery's structural findings (grounding context).
   * @param {string} [input.companySlug]
   * @param {string} [input.companyName]
   * @param {string} [input.url]
   * @returns {Promise<object>} Findings matching contracts/vision_ux_analysis.schema.json.
   */
  async analyze(input) {
    throw new Error(`${this.constructor.name} must implement analyze(input)`);
  }

  /**
   * Structural visual detection only: what UI elements are present on a
   * screenshot, with no UX judgment, no scoring, no recommendations, no
   * competitor comparison — see 13_Orchestrator/stages/visionStage.js, the
   * only caller. Sprint 21's addition, alongside analyze() (added Sprint
   * 15), not a replacement for it — analyze() remains the Discovery-
   * grounded qualitative-narrative contract for the 'homepage' benchmark
   * type; describe() is the Runtime pipeline's Vision Stage contract,
   * which has no Discovery stage anywhere upstream of it.
   *
   * Never throws; resolves { success, findings, jsonPath, timing, error }.
   * findings shape: { page_type, ui_sections, navigation_detected,
   * cards_detected, forms_detected, buttons_detected, banners_detected,
   * search_widgets_detected, filters_detected, ai_features_detected,
   * confidence }. jsonPath is where the Provider wrote findings to disk
   * (see OpenAIVisionProvider.js), null on failure.
   *
   * @param {object} input
   * @param {string} input.screenshotPath - full-page screenshot from the Screenshot stage.
   * @param {string} [input.companySlug]
   * @param {string} [input.url]
   * @param {string} [input.title]
   */
  async describe(input) {
    throw new Error(`${this.constructor.name} must implement describe(input)`);
  }
}
