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
 *
 * BUDGET MODEL (fixed after the "aborted at 25s" incident):
 *   startedAt        — process enters runAutonomousNavigation()
 *   agentStartedAt   — agent.execute() is actually called (AFTER Stagehand init
 *                      + first navigation). THE AGENT BUDGET IS MEASURED FROM
 *                      HERE, so slow session creation never eats navigation time.
 *   agentDeadline    = agentStartedAt + agentMaxMs
 *   sessionDeadline  = startedAt + browserbaseSessionTimeoutMs - evidenceReserveMs
 *   The run aborts at whichever deadline is first; evidenceReserveMs is always
 *   subtracted from the END so the terminal screenshot can be taken.
 */
import { buildSystemPrompt, buildAgentInstruction } from './agentInstructions.js';
import { toAgentVariables, buildTestProfile } from './safeSyntheticProfile.js';
import { SAFETY_INIT_SCRIPT, drainDomSafetyBlocks, safetyProbe } from './safetyPolicy.js';
import { verifyTarget, acceptCompletion } from './targetVerifier.js';
import { makeTelemetry, scrub } from './navigationTelemetry.js';
import { makeEvidenceStore } from './evidenceCapture.js';
import { logInfo, logWarn, logError } from '../../../shared/logger.mjs';

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

// A deep transactional journey (search → results → fare → passenger details …)
// needs real navigation time. Anything below this is treated as a misconfig.
const MIN_DEEP_BUDGET_MS = 120 * 1000;

export const DEFAULT_AGENT_LIMITS = Object.freeze({
  maxSteps: 40,               // deep booking journeys need room; still bounded
  maxMs: 7 * 60 * 1000,       // 420_000 — usable AGENT budget, from agentStartedAt
  evidenceReserveMs: 25 * 1000,
  probeIntervalMs: 6000,
});

/** ms the underlying Browserbase session is allowed to live (default 15 min). */
export function browserbaseSessionTimeoutMs() {
  const secs = Number(process.env.BROWSERBASE_SESSION_TIMEOUT_SECS || 900);
  return (Number.isFinite(secs) && secs > 0 ? secs : 900) * 1000;
}

/**
 * LLM configuration for the agent.
 *  - env=BROWSERBASE (API mode): default to model "auto" — the Stagehand API
 *    picks a working model and uses ITS key, so a retired model id or a missing
 *    provider key can't kill the run. Overridable via AGENT_NAV_MODEL.
 *  - env=LOCAL: needs a concrete model + a provider key in the environment.
 */
export function detectAgentLlm() {
  const explicit = process.env.AGENT_NAV_MODEL;
  const useBrowserbase = agentUsesBrowserbase();
  if (useBrowserbase) return { provider: 'auto', model: explicit || 'auto', apiManaged: !explicit };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: explicit || 'anthropic/claude-sonnet-4-5-20250929' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: explicit || 'openai/gpt-4.1-mini' };
  if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) return { provider: 'google', model: explicit || 'google/gemini-2.5-flash' };
  return null;
}

function agentUsesBrowserbase() {
  // Mirrors browserLauncher.js: needs the API key + browserbase provider;
  // projectId is passed through when present but is not required here.
  return !!process.env.BROWSERBASE_API_KEY
    && (process.env.BROWSER_PROVIDER || 'local').toLowerCase() === 'browserbase';
}

/** Whether agent-mode CAN run in this environment. */
export function agentModeAvailable() {
  if (agentUsesBrowserbase()) return true; // API mode manages the model itself
  // LOCAL mode needs a provider key
  return !!detectAgentLlm() && (process.env.BROWSER_PROVIDER || 'local').toLowerCase() === 'local';
}

/** Compute + sanity-check the effective limits. Never returns a budget < MIN. */
export function resolveEffectiveLimits(limits = {}) {
  const L = { ...DEFAULT_AGENT_LIMITS, ...limits };
  const sessionMs = browserbaseSessionTimeoutMs();
  // The deep-journey floor. Tests pass minBudgetMs:0 to exercise short budgets;
  // production never does.
  const minBudgetMs = Number.isFinite(L.minBudgetMs) ? L.minBudgetMs : MIN_DEEP_BUDGET_MS;
  let agentMaxMs = Math.round(L.maxMs);
  const warnings = [];

  if (!Number.isFinite(agentMaxMs) || agentMaxMs < minBudgetMs) {
    warnings.push(`configured agent budget ${agentMaxMs}ms is below the ${minBudgetMs}ms deep-journey minimum — using the default`);
    agentMaxMs = Math.max(DEFAULT_AGENT_LIMITS.maxMs, minBudgetMs);
  }
  // Evidence reserve can NEVER become the effective budget. Cap it at 1/6.
  let evidenceReserveMs = Math.min(Math.max(0, Math.round(L.evidenceReserveMs)), Math.floor(agentMaxMs / 6));
  if (evidenceReserveMs !== L.evidenceReserveMs) {
    warnings.push(`evidence reserve clamped ${L.evidenceReserveMs}→${evidenceReserveMs}ms so it can't consume the navigation budget`);
  }
  // The agent budget + reserve must fit inside the infra session.
  const maxBySession = sessionMs - evidenceReserveMs - 30_000; // 30s headroom for init/goto
  if (agentMaxMs > maxBySession && maxBySession >= MIN_DEEP_BUDGET_MS) {
    warnings.push(`agent budget ${agentMaxMs}ms exceeds what the ${Math.round(sessionMs / 1000)}s Browserbase session allows — reduced to ${maxBySession}ms`);
    agentMaxMs = maxBySession;
  }
  return {
    maxSteps: L.maxSteps,
    probeIntervalMs: L.probeIntervalMs,
    agentMaxMs,
    evidenceReserveMs,
    browserbaseSessionTimeoutMs: sessionMs,
    warnings,
  };
}

async function defaultStagehandFactory({ logger }) {
  const mod = await import('@browserbasehq/stagehand');
  const Stagehand = mod.Stagehand || mod.V3 || (mod.default && (mod.default.Stagehand || mod.default.V3));
  if (!Stagehand) throw new AgentNavUnavailableError('@browserbasehq/stagehand did not export Stagehand/V3');
  const llm = detectAgentLlm();
  const useBrowserbase = agentUsesBrowserbase();
  const sessionSecs = Math.round(browserbaseSessionTimeoutMs() / 1000);
  return new Stagehand({
    env: useBrowserbase ? 'BROWSERBASE' : 'LOCAL',
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserbaseSessionCreateParams: useBrowserbase
      ? { projectId: process.env.BROWSERBASE_PROJECT_ID, timeout: sessionSecs }
      : undefined,
    model: llm ? llm.model : 'openai/gpt-4.1-mini',
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

  const eff = resolveEffectiveLimits(limits);
  for (const w of eff.warnings) logWarn('agent_nav_budget_adjusted', { feature, detail: w });

  const startedAt = Date.now();
  const tel = makeTelemetry({ feature, detectorKey, startedAt });
  const evidence = makeEvidenceStore(company || feature);
  const interactionsPerformed = [];
  const classificationsSeen = new Set(['AGENT_DECISION']);
  const safetyBlocks = [];
  let deepestUrl = startingUrl || null;
  let stopReason = null;
  let stopStatus = null;
  let weAborted = false;              // did OUR code call controller.abort()?
  let lastStateSig = null;
  let watchdogVerify = null;
  let agentStartedAt = null;

  const llm = detectAgentLlm();
  if (!llm) throw new AgentNavUnavailableError('no agent LLM configuration (needs Browserbase API mode, or a provider key for LOCAL mode)');

  const perf = (phase, t0, extra) => tel.perf(phase, Date.now() - t0, extra);

  let sh;
  const controller = new AbortController();
  let agentDeadlineTimer = null;
  let sessionDeadlineTimer = null;
  let watchdog = null;

  const abortRun = (status, reason) => {
    stopStatus = stopStatus || status;
    stopReason = stopReason || reason;
    weAborted = true;
    try { controller.abort(); } catch { /* ignore */ }
  };

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
    tel.start({
      startingUrl, provider: llm.provider,
      agentMaxMs: eff.agentMaxMs,
      agentMaxSteps: eff.maxSteps,
      evidenceReserveMs: eff.evidenceReserveMs,
      browserbaseSessionTimeoutMs: eff.browserbaseSessionTimeoutMs,
      // effective deadline (from run start): min(sessionEnd - reserve, initHeadroom + agentBudget)
      effectiveDeadlineMs: Math.min(eff.browserbaseSessionTimeoutMs - eff.evidenceReserveMs, 60_000 + eff.agentMaxMs),
    });

    // ── phase: stagehand_init ───────────────────────────────────────────
    let t0 = Date.now();
    sh = await stagehandFactory({ logger: (ev, d) => logInfo(ev, d) });
    await sh.init();
    perf('stagehand_init', t0);

    const page = pageOf(sh);
    if (!page) throw new AgentNavUnavailableError('Stagehand session did not expose a page');

    try { await page.addInitScript(SAFETY_INIT_SCRIPT); } catch (e) { logError('agent_nav: addInitScript failed', e); }

    // ── phase: initial_navigation ──────────────────────────────────────
    t0 = Date.now();
    await page.goto(startingUrl, { waitUntil: 'domcontentloaded' }).catch(() => page.goto(startingUrl).catch(() => {}));
    deepestUrl = safeUrl(page) || startingUrl;
    perf('initial_navigation', t0);
    await evidence.milestone(page, 'entry');

    // NOTE: no separate consent act() here — it cost ~5-10s of pre-loop LLM
    // time. The agent's system prompt already instructs it to dismiss
    // cookie/consent banners as its first move, inside the measured budget.

    // ── overall session bound (from run start) — a hard ceiling so a hung
    //    agent/API call can't outlive the Browserbase session. ────────────
    const sessionCeilingMs = eff.browserbaseSessionTimeoutMs - eff.evidenceReserveMs - (Date.now() - startedAt);
    if (sessionCeilingMs > 5000) {
      sessionDeadlineTimer = setTimeout(() => abortRun(TARGET_STATUS.MAX_TIME, `hit the Browserbase session ceiling (~${Math.round(eff.browserbaseSessionTimeoutMs / 1000)}s) before reaching "${feature}"`), sessionCeilingMs);
    }

    // ── phase: agent_create ────────────────────────────────────────────
    t0 = Date.now();
    const instruction = buildAgentInstruction({ company, feature, detectorKey, startingUrl });
    const variables = toAgentVariables(profile);
    const agent = sh.agent({ systemPrompt: buildSystemPrompt() });
    perf('agent_create', t0);

    // Watchdog: independent verification + safety, parallel to the agent.
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
          abortRun(TARGET_STATUS.SAFETY, `safety boundary: ${probe.reason}`);
          return;
        }
        if (v.reached) {
          abortRun(TARGET_STATUS.REACHED, `target verified: ${v.signals.join('; ')}`);
          return;
        }
        const sig = v.detectedStates.join('|');
        if (sig && sig !== lastStateSig) { lastStateSig = sig; await evidence.milestone(page, sig.split(':')[0] || 'state'); }

        // Evidence-reserve early stop — measured from AGENT start, not run start.
        if (agentStartedAt && Date.now() - agentStartedAt >= eff.agentMaxMs - eff.evidenceReserveMs) {
          abortRun(TARGET_STATUS.MAX_TIME, `stopped ~${Math.round(eff.evidenceReserveMs / 1000)}s before the ${Math.round(eff.agentMaxMs / 1000)}s agent budget so the deepest page could be captured; "${feature}" was not reached`);
        }
      } catch (err) {
        logError('agent_nav watchdog tick failed', err);
      }
    }, eff.probeIntervalMs);

    // ── phase: agent_execute — THE AGENT BUDGET STARTS NOW ──────────────
    agentStartedAt = Date.now();
    agentDeadlineTimer = setTimeout(
      () => abortRun(TARGET_STATUS.MAX_TIME, `hit the ${Math.round(eff.agentMaxMs / 1000)}s agent navigation budget before reaching "${feature}"`),
      eff.agentMaxMs,
    );
    tel.perf('agent_execute_start', 0, { note: 'agent navigation budget started', agentMaxMs: eff.agentMaxMs });

    let execResult;
    const execT0 = Date.now();
    try {
      execResult = await agent.execute({
        instruction,
        maxSteps: eff.maxSteps,
        variables,
        signal: controller.signal,
        excludeTools: ['search'],
      });
    } catch (err) {
      execResult = { _error: err };
    }
    perf('agent_execute', execT0);

    if (watchdog) { clearInterval(watchdog); watchdog = null; }
    if (agentDeadlineTimer) { clearTimeout(agentDeadlineTimer); agentDeadlineTimer = null; }
    if (sessionDeadlineTimer) { clearTimeout(sessionDeadlineTimer); sessionDeadlineTimer = null; }

    if (execResult && Array.isArray(execResult.actions)) {
      for (const a of execResult.actions.slice(0, 60)) {
        interactionsPerformed.push(scrub(a.type ? `${a.type}${a.instruction ? `: ${a.instruction}` : ''}` : JSON.stringify(a)));
      }
    }
    if (execResult && execResult.message) interactionsPerformed.push(`Agent: ${scrub(execResult.message)}`);
    if (execResult && execResult._error) interactionsPerformed.push(`Agent error: ${scrub(execResult._error.message)}`);

    const finalVerify = await verifyTarget(page, detectorKey);
    deepestUrl = finalVerify.url || deepestUrl;
    tel.targetCheck(finalVerify);
    const gate = acceptCompletion(finalVerify, execResult && execResult.completed);
    const errMsg = execResult && execResult._error ? String(execResult._error.message || execResult._error) : '';
    const isAbortErr = /\b(abort|aborted|the operation was aborted)\b/i.test(errMsg);

    let status;
    let reason;
    if (gate.targetReached) {
      status = TARGET_STATUS.REACHED;
      reason = null;
    } else if (stopStatus === TARGET_STATUS.SAFETY) {
      status = TARGET_STATUS.SAFETY;
      reason = stopReason;
    } else if (weAborted) {
      // OUR abort (deadline / session ceiling / evidence reserve).
      status = stopStatus || TARGET_STATUS.MAX_TIME;
      reason = stopReason || `run aborted after ${Math.round((Date.now() - startedAt) / 1000)}s`;
    } else if (execResult && execResult._error && isAbortErr) {
      // An abort-shaped error we did NOT cause — a Stagehand / model / infra
      // failure. This is the class of bug that used to hide as "max_time".
      status = TARGET_STATUS.BLOCKER;
      reason = `the browser agent stopped with an abort-shaped error we did not trigger (likely a Stagehand API / model / Browserbase failure): ${scrub(errMsg)}`;
    } else if (execResult && execResult._error) {
      status = TARGET_STATUS.BLOCKER;
      reason = `agent execution error: ${scrub(errMsg)}`;
    } else if (execResult && execResult.completed) {
      status = TARGET_STATUS.BLOCKER;
      reason = `agent reported completion but the ${feature} detector did not confirm it (confidence: ${finalVerify.confidence}); deepest state: ${finalVerify.detectedStates.join(', ') || 'unknown'}`;
    } else {
      status = TARGET_STATUS.MAX_STEPS;
      reason = `agent used its ${eff.maxSteps} step budget without reaching "${feature}"`;
    }

    const term = await evidence.captureTerminal(page, status);
    const res = finish(status, reason, finalVerify);
    res.effectiveLimits = eff;
    res.evidence = evidence.result().terminal;
    res.milestones = evidence.result().milestones;
    if (term) {
      res.evidenceOverride = { screenshotPath: term.path, pageUrl: term.url, pageTitle: term.title, pageHtml: term.html };
    }
    return res;
  } catch (err) {
    if (err instanceof AgentNavUnavailableError) throw err;
    logError('agent_nav: fatal', err);
    let over = null;
    try { const p = pageOf(sh); if (p) { const t = await evidence.captureTerminal(p, 'crash'); if (t) over = { screenshotPath: t.path, pageUrl: t.url, pageTitle: t.title, pageHtml: t.html }; } } catch { /* ignore */ }
    const res = finish(TARGET_STATUS.BLOCKER, `agent navigation crashed: ${scrub(err.message)}`, watchdogVerify);
    res.effectiveLimits = eff;
    res.evidence = evidence.result().terminal;
    if (over) res.evidenceOverride = over;
    return res;
  } finally {
    if (watchdog) clearInterval(watchdog);
    if (agentDeadlineTimer) clearTimeout(agentDeadlineTimer);
    if (sessionDeadlineTimer) clearTimeout(sessionDeadlineTimer);
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
