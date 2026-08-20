/**
 * ReasoningProvider — the contract for any AI agent backend capable of
 * autonomously executing a benchmark's trigger prompt (navigate, capture,
 * score, write — the full "Benchmark [Company]" workflow), end to end.
 *
 * This is the platform-wide name for the seam 10_Dashboard/lib/providers/
 * AgentProvider.js already introduced. It is not a replacement for that
 * class — see ClaudeReasoningProvider.js, which re-exports the existing
 * ClaudeProvider unmodified. This file exists so other capabilities in
 * 12_Provider_Layer/ share one naming convention, and so a future
 * OpenAIReasoningProvider/GeminiReasoningProvider has a contract to
 * implement that isn't scoped to "Claude" or "Agent" in its name.
 */
export class ReasoningProvider {
  /**
   * @param {object} job
   * @param {string} job.prompt - the exact trigger prompt to execute.
   * @param {string} job.cwd    - working directory the agent should run in.
   * @param {string} job.jobId  - opaque id for logging only.
   * @returns {Promise<{status: 'completed'|'failed', raw?: string, error?: string}>}
   */
  async run(job) {
    throw new Error(`${this.constructor.name} must implement run(job)`);
  }
}
