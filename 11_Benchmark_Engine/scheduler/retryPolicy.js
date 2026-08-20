/**
 * retryPolicy — pure decision function for whether a failed job gets another
 * attempt, and how long the scheduler should wait before re-queueing it.
 * Deliberately has zero knowledge of workers, processes, or the queue — it
 * only answers "given this many attempts so far, what next?" so it can be
 * unit-tested without spinning up any real infrastructure.
 */

const DEFAULT_MAX_ATTEMPTS = 3; // 1 initial attempt + 2 retries
const DEFAULT_BASE_DELAY_MS = 2000;

/**
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts] total attempts allowed, including the first
 * @param {number} [opts.baseDelayMs] backoff base — actual delay is
 *   baseDelayMs * 2^(attemptsSoFar - 1), so retries back off exponentially
 * @returns {{ maxAttempts: number, nextDelayMs: (attemptsSoFar: number) => number,
 *             shouldRetry: (attemptsSoFar: number, error: Error) => boolean }}
 */
export function createRetryPolicy({ maxAttempts = DEFAULT_MAX_ATTEMPTS, baseDelayMs = DEFAULT_BASE_DELAY_MS } = {}) {
  if (maxAttempts < 1) throw new RangeError('maxAttempts must be >= 1');

  return {
    maxAttempts,

    /** Exponential backoff: 2s, 4s, 8s, ... capped implicitly by maxAttempts. */
    nextDelayMs(attemptsSoFar) {
      return baseDelayMs * 2 ** Math.max(0, attemptsSoFar - 1);
    },

    /**
     * Decides whether another attempt is warranted. Some failures are not
     * worth retrying — e.g. a malformed URL will fail identically every time,
     * so retrying it just burns a worker slot for no benefit. Everything else
     * (network hiccups, a page that didn't settle in time, a transient
     * OpenAI rate limit) is treated as retryable.
     *
     * V1 Stabilization: also honors an explicit `error.permanent === true`
     * flag, which the Anti-Bot Layer sets when it has already confirmed (via
     * its own strategy attempts) that a company's homepage is behind
     * Cloudflare/Akamai/a CAPTCHA/etc. Retrying a confirmed protected page
     * 2 more times at the job level just repeats the same conclusion slower
     * — this is the mechanism "reduce unnecessary waiting" relies on.
     */
    shouldRetry(attemptsSoFar, error) {
      if (attemptsSoFar >= maxAttempts) return false;
      if (error?.permanent === true) return false;
      const message = String(error?.message || error || '');
      const nonRetryable = /invalid url|unsupported protocol|ERR_INVALID_URL/i;
      return !nonRetryable.test(message);
    },
  };
}
