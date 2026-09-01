/**
 * Navigation Runner — per-step execution.
 * Runs one JourneyStep against a single, continuous page. Session state
 * (a dismissed cookie banner, an opened chat) carries across steps flagged
 * depends_on_previous; independent steps re-baseline from starting_url first,
 * so one step's side effects don't silently leak into an unrelated one.
 */

import { performStepAction, safeGoto } from './actions.js';
import { captureStepEvidence } from './capture.js';
import { attemptRecovery } from './recovery.js';
import { logInfo, logError } from '../../../shared/logger.mjs';

/**
 * executeStep — attempts one JourneyStep, captures evidence regardless of
 * outcome, and never throws: every failure mode resolves to a result object
 * with status 'success' | 'failed' | 'skipped' so the run can continue.
 */
export async function executeStep({ page, step, index, journeyPlan, companySlug, runId, previousStepFailed }) {
  const startedAt = Date.now();
  logInfo('Navigation Runner: step starting', { stepId: step.id, index, runId });

  if (step.depends_on_previous && previousStepFailed) {
    const actionResult = {
      success: false,
      action_taken: null,
      error: 'Skipped — the step this one depends on did not succeed.',
    };
    const evidence = await captureStepEvidence(page, { companySlug, runId, index, step, actionResult });
    return {
      step_id: step.id,
      title: step.title,
      status: 'skipped',
      action_taken: null,
      error: actionResult.error,
      recovered: false,
      ...evidence,
      execution_time_ms: Date.now() - startedAt,
    };
  }

  if (!step.depends_on_previous) {
    try {
      await safeGoto(page, journeyPlan.starting_url);
    } catch (err) {
      // Intentional swallow, unchanged — a failed re-baseline is reported
      // as this step's own failure so the run continues; logged, not
      // rethrown, since rethrowing would abort the whole journey and
      // change this file's existing per-step resilience behavior.
      logError('Navigation Runner: step re-baseline navigation failed', err, { stepId: step.id, index, runId });
      const actionResult = { success: false, action_taken: null, error: `Could not reload starting_url: ${err.message}` };
      const evidence = await captureStepEvidence(page, { companySlug, runId, index, step, actionResult });
      return {
        step_id: step.id,
        title: step.title,
        status: 'failed',
        action_taken: null,
        error: actionResult.error,
        recovered: false,
        ...evidence,
        execution_time_ms: Date.now() - startedAt,
      };
    }
  }

  let actionResult;
  try {
    actionResult = await performStepAction(page, step);
  } catch (err) {
    // Intentional swallow, unchanged — see the header comment: one bad
    // step must never abort the whole journey. Logged, not rethrown.
    logError('Navigation Runner: step action threw', err, { stepId: step.id, index, runId });
    actionResult = { success: false, error: err.message, action_taken: null };
  }

  let recovered = false;
  if (!actionResult.success) {
    actionResult = await attemptRecovery({ page, step, previousResult: actionResult });
    recovered = !!actionResult.recovered;
  }

  const evidence = await captureStepEvidence(page, { companySlug, runId, index, step, actionResult });

  const status = actionResult.success ? 'success' : 'failed';
  logInfo('Navigation Runner: step finished', { stepId: step.id, index, runId, status, recovered, durationMs: Date.now() - startedAt });

  return {
    step_id: step.id,
    title: step.title,
    status,
    action_taken: actionResult.action_taken,
    error: actionResult.error || null,
    recovered,
    consent: actionResult.consent || null,   // audit: was a cookie overlay handled?
    goal: actionResult.goal || null,         // goal-driven navigation result (if any)
    ...evidence,
    execution_time_ms: Date.now() - startedAt,
  };
}
