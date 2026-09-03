/**
 * autonomous_navigator/autonomousNavigator — AGENT-FIRST open-ended navigation.
 *
 * The browser agent (Stagehand v3 `agent().execute()`, DOM tool mode) decides
 * WHAT to click / type / select next. OUR code owns:
 *   - the task objective (agentInstructions)
 *   - deterministic safety (safetyPolicy: injected guard + Node-side probe)
 *   - the step / time budget
 *   - synthetic data (safeSyntheticProfile → Stagehand `variables`, never logged)
 *   - independent target verification (targetVerifier → feature detectors)
 *   - evidence capture (evidenceCapture)
 *   - telemetry (navigationTelemetry: agent_nav_* events)
 *
 * Result shape matches goal_navigator's runGoalNavigation() so the rest of the
 * Navigation Runner / Feature Vision pipeline is unchanged.
 */
import { buildSystemPrompt, buildAgentInstruction } from './agentInstructions.js';
import { toAgentVariables, buildTestProfile } from './safeSyntheticProfile.js';
import { SAFETY_INIT_SCRIPT, drainDomSafetyBlocks, safetyProbe } from './safetyPolicy.js';
import { verifyTarget, acceptCompletion } from './targetVerifier.js';
import { makeTelemetry, scrub } from './navigationTelemetry.js';
import { makeEvidenceStore } from './evidenceCapture.js';
import { logInfo, logError } from '../../../shared/logger.mjs';

export class AgentNavUnavailableError extends Error {
  constructor(msg) { super(msg); this.name = 'AgentNavUnavailableError'; }
}

const TARGET_STATUS = {
  REACHED: 'target_reached',
  SAFETY: 'safety_boundary',
  AUTH: 'blocked_auth_or_booking_reference',
  BLOCKER: 'unrecoverable_blocker',
  MAX_STEPS: 'max_steps_exceeded',
  MAX_TIME: 'max_time_exceeded',
};
export { TARGET_STATUS };

export const DEFAULT_AGENT_LIMITS = Object.freeze({
  maxSteps: 40,          // deep booking journeys need room; still bounded
  maxMs: 8 * 60 * 1000,  // agent-mode budget; see Browserbase session timeout notes
  evidenceReserveMs: 25 * 1000,
  probeIntervalMs: 6000,
});

/** LLM provider Stagehand can use, inferred from the environment. */
export function detectAgentLlm() {
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: process.env.AGENT_NAV_MODEL || 'anthropic/claude-sonnet-4-5-20250929' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: process.env.AGENT_NAV_MODEL || 'openai/gpt-5-mini' };
  if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) return { provider: 'google', model: process.env.AGENT_NAV_MODEL || 'google/gemini-3-pro-preview' };
  return null;
}

/** Whether agent-mode CAN run in this environment (creds present). */
export function agentModeAvailable() {
  const bb = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
  const local = (process.env.BROWSER_PROVIDER || 'local').toLowerCase() === 'local';
  return !!detectAgentLlm() && (bb || local);
}

async function defaultStagehandFactory({ logger }) {
  const mod = await import('@browserbasehq/stagehand');
  const Stagehand = mod.Stagehand || mod.V3 || (mod.default && (mod.default.Stagehand || mod.default.V3));
  if (!Stagehand) throw new AgentNavUnavailableError('@browserbasehq/stagehand did not export Stagehand/V3');
  const llm = detectAgentLlm();
  const useBrowserbase = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID)
    && (process.env.BROWSER_PROVIDER || 'local').toLowerCase() === 'browserbase';
  const sessionSecs = Number(process.env.BROWSERBASE_SESSION_TIMEOUT_SECS || 900);
  return new Stagehand({
    env: useBrowserbase ? 'BROWSERBASE' : 'LOCAL',
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserbaseSessionCreateParams: useBrowserbase ? { projectId: process.env.BROWSERBASE_PROJECT_ID, timeout: sessionSecs } : undefined,
    model: llm ? llm.model : undefined,
    systemPrompt: buildSystemPrompt(),
    verbose: 0,
    disablePino: true,
    selfHeal: true,
    logger: (line) => { try { logger?.('stagehand', { level: line.level, message: scrub(line.message) }); } catch { /* ignore */ } },
  });
}

/**
 * @param {object} args
 * @param {string} args.startingUrl
 * @param {string} args.company
 * @param {string} args.feature        user-facing label ("Passenger Details")
 * @param {string} args.detectorKey    featureDetectors key ("passenger_details")
 * @param {object} [args.profile]
 * @param {object} [args.limits]
 * @param {Function} [args.stagehandFactory]  test seam
 */
export async function runAutonomousNavigation({
  startingUrl, company, feature, detectorKey,
  profile = buildTestProfile(),
  limits = {},
  stagehandFactory = defaultStagehandFactory,
} = {}) {
  if (!detectorKey) throw new AgentNavUnavailableError('runAutonomousNavigation requires a detectorKey');
  const L = { ...DEFAULT_AGENT_LIMITS, ...limits };
  const startedAt = Date.now();
  const tel = makeTelemetry({ feature, detectorKey, startedAt });
  const evidence = makeEvidenceStore(company || feature);
  const interactionsPerformed = [];
  const classificationsSeen = new Set(['AGENT_DECISION']);
  const safetyBlocks = [];
  let deepestUrl = startingUrl || null;
  let stopReason = null;
  let stopStatus = null;
  let lastStateSig = null;
  let watchdogVerify = null;

  const llm = detectAgentLlm();
  if (!llm) throw new AgentNavUnavailableError('no agent LLM key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY) is set');

  let sh;
  const controller = new AbortController();
  let deadlineTimer = null;
  let watchdog = null;

  const finish = (status, reason, verify) => {
    const v = verify || watchdogVerify || {};
    const res = {
      navigator: 'agent',
      targetStatus: status,
      targetReached: status === TARGET_STATUS.REACHED,
      feature: feature || null,
      detectorKey,
      deepestUrl: (v && v.url) || deepestUrl,
      deepestHeadings: (v && v.observation && v.observation.headings) || [],
      confidence: (v && v.confidence) || 'none',
      actionsTaken: interactionsPerformed.length,
      elapsedMs: Date.now() - startedAt,
      interactionsPerformed,
      classificationsSeen: [...classificationsSeen],
      blocker: status === TARGET_STATUS.REACHED ? null : (reason || `"${feature}" was not reached (${status})`),
      detector: v && v.reached ? { key: detectorKey, confidence: v.confidence, signals: v.signals } : null,
      safetyBlocks,
      evidence: null,
    };
    tel.stop({ status, targetReached: res.targetReached, confidence: res.confidence, reason: res.blocker || '', url: res.deepestUrl, actionsCompleted: interactionsPerformed.length });
    return res;
  };

  try {
    tel.start({ startingUrl, provider: llm.provider });
    sh = await stagehandFactory({ logger: (ev, d) => logInfo(ev, d) });
    await sh.init();

    const page = pageOf(sh);
    if (!page) throw new AgentNavUnavailableError('Stagehand session did not expose a page');

    // Deterministic safety guard — injected before any page script runs.
    try { await page.addInitScript(SAFETY_INIT_SCRIPT); } catch (e) { logError('agent_nav: addInitScript failed', e); }
    await page.goto(startingUrl, { waitUntil: 'domcontentloaded' }).catch(() => page.goto(startingUrl));
    deepestUrl = safeUrl(page) || startingUrl;

    // Cheap consent dismissal via a single act() (not the agent loop).
    try { await sh.act('Dismiss any cookie consent banner, privacy prompt, or marketing popup if one is visible'); }
    catch (e) { logInfo('agent_nav: consent act no-op', { note: scrub(e && e.message) }); }
    await evidence.milestone(page, 'entry');

    // Hard time budget.
    deadlineTimer = setTimeout(() => { stopReason = stopReason || `hit the ${Math.round(L.maxMs / 1000)}s agent budget`; stopStatus = stopStatus || TARGET_STATUS.MAX_TIME; try { controller.abort(); } catch { /* ignore */ } }, L.maxMs);

    // Watchdog: independent verification + safety, in parallel with the agent.
    watchdog = setInterval(async () => {
      try {
        const v = await verifyTarget(page, detectorKey);
        watchdogVerify = v;
        deepestUrl = v.url || deepestUrl;
        tel.state(v);
        tel.targetCheck(v);

        const domBlocks = await drainDomSafetyBlocks(page);
        for (const b of domBlocks) { safetyBlocks.push({ ...b, source: 'dom' }); tel.safetyBlock(b.why, 'dom'); }

        const probe = safetyProbe(v.observation, detectorKey);
        if (probe.violation) {
          safetyBlocks.push({ why: probe.reason, source: 'probe', at: v.url });
          tel.safetyBlock(probe.reason, 'probe');
          stopReason = `safety boundary: ${probe.reason}`;
          stopStatus = TARGET_STATUS.SAFETY;
          try { controller.abort(); } catch { /* ignore */ }
          return;
        }
        if (v.reached) {
          stopReason = `target verified: ${v.signals.join('; ')}`;
          stopStatus = TARGET_STATUS.REACHED;
          try { controller.abort(); } catch { /* ignore */ }
          return;
        }
        // milestone screenshot on a state transition
        const sig = v.detectedStates.join('|');
        if (sig && sig !== lastStateSig) { lastStateSig = sig; await evidence.milestone(page, sig.split(':')[0] || 'state'); }

        if (Date.now() - startedAt >= L.maxMs - L.evidenceReserveMs) {
          stopReason = stopReason || 'stopped early to preserve evidence before the session budget';
          stopStatus = stopStatus || TARGET_STATUS.MAX_TIME;
          try { controller.abort(); } catch { /* ignore */ }
        }
      } catch (err) {
        logError('agent_nav watchdog tick failed', err);
      }
    }, L.probeIntervalMs);

    const instruction = buildAgentInstruction({ company, feature, detectorKey, startingUrl });
    const variables = toAgentVariables(profile);
    const agent = sh.agent({ systemPrompt: buildSystemPrompt() });

    let execResult;
    try {
      execResult = await agent.execute({
        instruction,
        maxSteps: L.maxSteps,
        variables,
        signal: controller.signal,
        excludeTools: ['search'], // web search not needed; keeps it on-site
      });
    } catch (err) {
      execResult = { _error: err };
    }

    if (watchdog) { clearInterval(watchdog); watchdog = null; }

    // Record the agent's action types (safe — no values).
    if (execResult && Array.isArray(execResult.actions)) {
      for (const a of execResult.actions.slice(0, 60)) {
        interactionsPerformed.push(scrub(a.type ? `${a.type}${a.instruction ? `: ${a.instruction}` : ''}` : JSON.stringify(a)));
      }
    }
    if (execResult && execResult.message) interactionsPerformed.push(`Agent: ${scrub(execResult.message)}`);
    if (execResult && execResult._error) interactionsPerformed.push(`Agent error: ${scrub(execResult._error.message)}`);

    // Authoritative final verification.
    const finalVerify = await verifyTarget(page, detectorKey);
    deepestUrl = finalVerify.url || deepestUrl;
    tel.targetCheck(finalVerify);
    const gate = acceptCompletion(finalVerify, execResult && execResult.completed);

    let status;
    let reason;
    if (gate.targetReached) {
      status = TARGET_STATUS.REACHED;
      reason = null;
    } else if (stopStatus === TARGET_STATUS.SAFETY) {
      status = TARGET_STATUS.SAFETY;
      reason = stopReason;
    } else if (stopStatus === TARGET_STATUS.MAX_TIME) {
      status = TARGET_STATUS.MAX_TIME;
      reason = stopReason;
    } else if (execResult && execResult._error && /abort/i.test(execResult._error.message || '')) {
      status = stopStatus || TARGET_STATUS.MAX_TIME;
      reason = stopReason || 'agent aborted';
    } else if (execResult && execResult._error) {
      status = TARGET_STATUS.BLOCKER;
      reason = `agent execution error: ${scrub(execResult._error.message)}`;
    } else if (execResult && execResult.completed) {
      status = TARGET_STATUS.BLOCKER;
      reason = `agent reported completion but the ${feature} detector did not confirm it (confidence: ${finalVerify.confidence}); deepest state: ${finalVerify.detectedStates.join(', ') || 'unknown'}`;
    } else {
      status = TARGET_STATUS.MAX_STEPS;
      reason = `agent used its ${L.maxSteps} step budget without reaching "${feature}"`;
    }

    const term = await evidence.captureTerminal(page, status);
    const res = finish(status, reason, finalVerify);
    res.evidence = evidence.result().terminal;
    res.milestones = evidence.result().milestones;
    if (term) {
      res.evidenceOverride = {
        screenshotPath: term.path, pageUrl: term.url, pageTitle: term.title, pageHtml: term.html,
      };
    }
    return res;
  } catch (err) {
    if (err instanceof AgentNavUnavailableError) throw err;
    logError('agent_nav: fatal', err);
    // Best-effort terminal evidence even on a crash.
    let over = null;
    try { const p = pageOf(sh); if (p) { const t = await evidence.captureTerminal(p, 'crash'); if (t) over = { screenshotPath: t.path, pageUrl: t.url, pageTitle: t.title, pageHtml: t.html }; } } catch { /* ignore */ }
    const res = finish(TARGET_STATUS.BLOCKER, `agent navigation crashed: ${scrub(err.message)}`, watchdogVerify);
    res.evidence = evidence.result().terminal;
    if (over) res.evidenceOverride = over;
    return res;
  } finally {
    if (watchdog) clearInterval(watchdog);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    // The autonomous navigator owns the Stagehand session it created — and only
    // that. It never touches the Navigation Runner's own browser/page.
    try { if (sh && typeof sh.close === 'function') await sh.close(); } catch (e) { logError('agent_nav: stagehand close failed', e); }
  }
}

function pageOf(sh) {
  if (!sh) return null;
  try {
    if (sh.context && typeof sh.context.activePage === 'function') return sh.context.activePage();
  } catch { /* ignore */ }
  if (sh.page) return sh.page;
  return null;
}
function safeUrl(page) { try { return page.url(); } catch { return null; } }
