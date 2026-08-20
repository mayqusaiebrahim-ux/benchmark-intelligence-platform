/**
 * ReportProvider — the contract for an AI backend that generates a
 * benchmark deliverable (executive summary, journey step narrative, UX
 * analysis, etc.) from structured findings.
 *
 * Interface only this sprint — no default implementation. Nothing in the
 * platform today generates a report via an AI vendor call:
 * 11_Benchmark_Engine/modules/reports/homepageReport.js's
 * renderHomepageReportMarkdown() is deterministic templating over
 * Discovery + Vision output, not its own AI call. There is no existing
 * AI-vendor-coupled report writer to wrap, so — per "do not implement all
 * providers" — none is invented here. A ClaudeReportProvider/
 * GPTReportProvider becomes real only once such a writer exists.
 */
export class ReportProvider {
  /**
   * @param {object} input - discovery findings, vision findings, and
   *   whatever other structured context the deliverable is generated from.
   * @returns {Promise<object>}
   */
  async generate(input) {
    throw new Error(`${this.constructor.name} must implement generate(input)`);
  }
}
