/**
 * Navigation Runner — failure recovery.
 * Bounded and graceful: at most one retry per step, after a short settle
 * wait — the most common real failure is the target rendering late, not
 * being truly absent. Never loops, never throws. A step that still fails
 * after recovery is marked failed by the caller and the run continues; one
 * bad step must never abort the whole journey.
 */

import { performStepAction } from './actions.js';

/**
 * attemptRecovery — called only when a step's first attempt failed. Waits
 * briefly, then tries the exact same, already-safety-checked action once
 * more. Returns the retry's result (tagged recovered:true if it succeeded)
 * or falls back to the original failure.
 */
export async function attemptRecovery({ page, step, previousResult }) {
  try {
    await page.waitForTimeout(1500);
    const retryResult = await performStepAction(page, step);
    if (retryResult.success) {
      return { ...retryResult, recovered: true };
    }
    return { ...retryResult, recovered: false };
  } catch (err) {
    return {
      success: false,
      error: previousResult?.error || err.message,
      action_taken: null,
      recovered: false,
    };
  }
}
