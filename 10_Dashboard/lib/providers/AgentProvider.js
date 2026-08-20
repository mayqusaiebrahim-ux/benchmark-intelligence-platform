/**
 * AgentProvider — the contract every AI agent backend must implement to
 * actually execute a benchmark request's trigger prompt.
 *
 * This is the seam Sprint V1.5 exists to create: benchmarkService.js knows
 * nothing about Claude, OpenAI, Gemini, or a local agent — it only knows it
 * has something shaped like this. ClaudeProvider is Phase 1's only
 * implementation; a future OpenAIProvider/GeminiProvider/LocalAgentProvider
 * plugs in here without benchmarkService.js, server.js, or the Dashboard UI
 * changing at all.
 *
 * Phase 1 scope only: run() reports exactly two outcomes, 'completed' or
 * 'failed'. No live sub-stage progress, no retries, no timeout/kill policy —
 * those are explicitly deferred to a later phase once this foundation is
 * proven to work.
 */
export class AgentProvider {
  /**
   * @param {object} job
   * @param {string} job.prompt    - the exact trigger prompt to execute, unchanged from
   *                                 requestsStore.js's existing buildTriggerPrompt() output.
   * @param {string} job.cwd       - working directory the agent should run in (the project
   *                                 root) — this is what makes the agent write into the
   *                                 existing Benchmark Repository structure unmodified.
   * @param {string} job.jobId     - opaque id for logging only (e.g. `${requestId}:${slug}`).
   * @returns {Promise<{status: 'completed'|'failed', raw?: string, error?: string}>}
   */
  async run(job) {
    throw new Error(`${this.constructor.name} must implement run(job)`);
  }
}
