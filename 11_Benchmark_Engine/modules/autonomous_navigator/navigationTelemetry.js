/**
 * autonomous_navigator/navigationTelemetry — agent-level events. Only SAFE
 * metadata is ever logged: step number, URL, detected page state, action TYPE,
 * a short control description, target confidence, elapsed time, stop reason.
 * Never synthetic personal values, never secrets, never full model output.
 */
import { logInfo, logWarn } from '../../../shared/logger.mjs';

// Redact anything that looks like a value the synthetic profile could contain.
const REDACT = [
  /benchmark\.test\.traveler@example\.com/gi,
  /\+?9665555\d{5,}/g,
  /\bTest Traveler\b/gi,
  /\b1990-01-15\b/g,
  /%\w+%/g, // Stagehand variable placeholders
];
export function scrub(s) {
  let out = String(s == null ? '' : s);
  for (const re of REDACT) out = out.replace(re, '‹redacted›');
  return out.slice(0, 300);
}

// URLs are logged as-is but capped (a data: URL or a long tracking query can be huge).
const capUrl = (u) => (u == null ? null : String(u).slice(0, 300));

export function makeTelemetry({ feature, detectorKey, startedAt = Date.now() } = {}) {
  const elapsed = () => Date.now() - startedAt;
  let step = 0;
  return {
    start(extra = {}) {
      logInfo('agent_nav_start', { feature, detectorKey, ...extra });
    },
    perf(phase, durationMs, extra = {}) {
      logInfo('agent_nav_perf', { feature, phase, durationMs: Math.round(durationMs), elapsedMs: elapsed(), ...extra });
    },
    step(action) {
      step += 1;
      logInfo('agent_nav_step', {
        feature, stepNumber: step,
        currentUrl: capUrl(action.url),
        actionType: action.type || null,
        control: action.control ? scrub(action.control) : null,
        elapsedMs: elapsed(),
      });
      return step;
    },
    action(a) {
      logInfo('agent_nav_action', { feature, stepNumber: step, actionType: a.type || null, control: a.control ? scrub(a.control) : null, elapsedMs: elapsed() });
    },
    state(s) {
      logInfo('agent_nav_state', {
        feature, stepNumber: step,
        currentUrl: capUrl(s.url),
        detectedPageState: s.detectedStates && s.detectedStates.length ? s.detectedStates.join(',') : 'unknown',
        targetConfidence: s.confidence || 'none',
        elapsedMs: elapsed(),
      });
    },
    targetCheck(v) {
      logInfo('agent_nav_target_check', {
        feature, stepNumber: step,
        reached: !!v.reached, targetConfidence: v.confidence || 'none',
        signals: (v.signals || []).slice(0, 6),
        currentUrl: capUrl(v.url), elapsedMs: elapsed(),
      });
    },
    safetyBlock(reason, source) {
      logWarn('agent_nav_safety_block', { feature, stepNumber: step, source: source || 'probe', reason: scrub(reason), elapsedMs: elapsed() });
    },
    recovery(what) {
      logInfo('agent_nav_recovery', { feature, stepNumber: step, what: scrub(what), elapsedMs: elapsed() });
    },
    stop(r) {
      logInfo('agent_nav_stop', {
        feature, stepNumber: step,
        status: r.status,
        targetReached: !!r.targetReached,
        targetConfidence: r.confidence || 'none',
        stopReason: scrub(r.reason || ''),
        finalUrl: capUrl(r.url),
        actionsCompleted: r.actionsCompleted ?? step,
        elapsedMs: elapsed(),
      });
    },
    elapsed,
  };
}
