/**
 * Autonomous agent runs hold the global browser slot — offline. The real
 * browserLauncher gate is used; Playwright and the agent are mocked (no
 * browser, no network, no model call).
 *
 * Why: with BROWSER_PROVIDER=remote every run shares one worker browser, and
 * Stagehand drives the most recently active page in it. An agent run that
 * does not hold the slot could be hijacked by another run's Discovery page.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NAV = '../../../11_Benchmark_Engine/modules/autonomous_navigator/autonomousNavigator.js';

// Playwright mocked: a "local launch" returns a fake browser instantly.
mock.module(pathToFileURL(join(ROOT, '11_Benchmark_Engine', 'node_modules', 'playwright', 'index.mjs')).href, {
  namedExports: {
    chromium: {
      async launch() { return { version: () => '149.0.7827.55', on() {}, once() {}, async close() {} }; },
      async connectOverCDP() { throw new Error('not used'); },
      executablePath: () => '/nonexistent/chrome',
    },
  },
});

const { withBrowserSlot, browserSlotStatus, launchBrowser } =
  await import('../../../11_Benchmark_Engine/modules/browserLauncher.js');

// The agent is mocked: each call records the slot state, then waits on a gate.
const agent = { calls: [], gate: null, behavior: 'reach' };
function openGate() { let release; const p = new Promise((r) => { release = r; }); agent.gate = p; return release; }
mock.module(NAV, {
  namedExports: {
    ...(await import(NAV)),
    agentModeAvailable: () => true,
    runAutonomousNavigation: async (args) => {
      agent.calls.push({ args, slotDuringRun: browserSlotStatus() });
      if (agent.gate) await agent.gate;
      if (agent.behavior === 'throw') throw new Error('agent crashed');
      return { navigator: 'agent', targetStatus: 'target_reached', targetReached: true, interactionsPerformed: ['act'], safetyBlocks: [] };
    },
  },
});
const { performStepAction } = await import('../../../11_Benchmark_Engine/modules/navigation_runner/actions.js');

const STEP = { id: 'step_07_booking', goal_driven: true, detector_key: 'passenger_details', feature_label: 'Passenger Details' };
const CTX = { companySlug: 'air', startingUrl: 'https://air.test/' };

function setup(t, behavior = 'reach') {
  const saved = { mode: process.env.NAVIGATION_MODE, provider: process.env.BROWSER_PROVIDER };
  process.env.NAVIGATION_MODE = 'agent';
  process.env.BROWSER_PROVIDER = 'local';
  agent.calls.length = 0; agent.gate = null; agent.behavior = behavior;
  t.after(() => {
    for (const [k, v] of [['NAVIGATION_MODE', saved.mode], ['BROWSER_PROVIDER', saved.provider]]) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    assert.deepEqual(browserSlotStatus().active, 0, 'no slot leaked by this test');
  });
}
const pending = (p, ms = 50) => Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), ms))]);

test('withBrowserSlot: result passes through, errors propagate unchanged, slot always released', async () => {
  assert.equal(browserSlotStatus().max, 1, 'concurrency stays at 1');
  assert.equal(await withBrowserSlot(async () => { assert.equal(browserSlotStatus().active, 1); return 42; }), 42);
  assert.equal(browserSlotStatus().active, 0);
  await assert.rejects(withBrowserSlot(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(browserSlotStatus().active, 0);
});

test('a) the slot is HELD while autonomous navigation runs', async (t) => {
  setup(t);
  const r = await performStepAction(null, STEP, CTX);
  assert.equal(agent.calls.length, 1);
  assert.equal(agent.calls[0].slotDuringRun.active, 1, 'agent ran inside the global browser slot');
  assert.equal(r.success, true);
});

test('b) the slot is RELEASED after a successful agent run', async (t) => {
  setup(t);
  await performStepAction(null, STEP, CTX);
  assert.equal(browserSlotStatus().active, 0);
  assert.equal(browserSlotStatus().waiting, 0);
});

test('c) the slot is RELEASED when the agent fails; the existing clear error is preserved', async (t) => {
  setup(t, 'throw');
  const r = await performStepAction(null, STEP, CTX);
  assert.equal(browserSlotStatus().active, 0);
  assert.equal(r.success, false);
  assert.match(r.error, /was not reached — agent mode could not run and no browser is available for the heuristic fallback/);
});

test('d) a second browser run cannot overlap an agent run (it waits, then proceeds)', async (t) => {
  setup(t);
  const releaseAgent = openGate();
  const agentRun = performStepAction(null, STEP, CTX);
  await new Promise((r) => setTimeout(r, 10)); // agent now holds the slot
  assert.equal(browserSlotStatus().active, 1);

  const discovery = launchBrowser('Discovery'); // another request's browser work
  assert.equal(await pending(discovery), 'pending', 'second run is blocked while the agent holds the slot');
  assert.equal(browserSlotStatus().waiting, 1);

  releaseAgent();
  await agentRun;
  const session = await discovery; // proceeds only after the agent released
  assert.equal(browserSlotStatus().active, 1, 'slot handed to the waiting run');
  await session.close();
  assert.equal(browserSlotStatus().active, 0);
});

test('no deadlock: when the journey already holds the slot (runner page open), the agent does not re-acquire it', async (t) => {
  setup(t);
  const session = await launchBrowser('Navigation Runner'); // journey holds the only slot
  const page = { url: () => 'https://air.test/' };
  const r = await Promise.race([
    performStepAction(page, STEP, CTX),
    new Promise((_, rej) => setTimeout(() => rej(new Error('deadlock: agent waited for a slot its own journey holds')), 1000)),
  ]);
  assert.equal(r.success, true);
  assert.equal(browserSlotStatus().active, 1, 'still just the journey\'s own slot');
  await session.close();
});
