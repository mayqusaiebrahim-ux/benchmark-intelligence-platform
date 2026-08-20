/**
 * Anti-Bot fallback strategies — an ordered list of browser configurations
 * to try, each varying exactly the kinds of signals bot-defense systems key
 * off: automation fingerprints and navigation timing. Tried in order;
 * probe.js stops at the first one that gets a clean read, or aborts early if
 * a strategy's outcome is classified permanent (see detectors.js).
 *
 * V1 Stabilization: trimmed from 4 strategies to 2. `slow_human` and
 * `randomized_retry` (networkidle waits up to 45s, randomized delays up to
 * 6s, a third and fourth full browser launch) were the largest contributors
 * to "Homepage Benchmark is too slow" — and in practice, if a fingerprint
 * change (stealth_lite) doesn't get past a defense, more timing variation
 * rarely does either for the kind of enterprise bot management this project
 * has actually observed. Both remaining strategies share a consistent
 * 1440x900 viewport specifically so the capture (§ probe.js) reliably
 * frames the same nav+hero+search-widget+promo region regardless of which
 * strategy succeeded.
 *
 * This is a real, honest constraint worth stating plainly: these strategies
 * affect the ANTI-BOT PROBE's own navigation only. Discovery (unmodified)
 * always launches its own fresh, vanilla browser afterward — this layer
 * cannot inject these flags into Discovery's internal chromium.launch()
 * call. What it CAN do is fail fast with a real diagnosis when nothing gets
 * past the defense (skipping a Discovery run that would almost certainly
 * also fail), and give soft/rate-limited sites a real second chance before
 * Discovery even runs.
 */

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CAPTURE_VIEWPORT = { width: 1440, height: 900 };

// V1.1 Performance: flags that speed up Chromium's own startup/process
// architecture (sandbox setup, GPU process init, first-run checks). These
// are NOT fingerprint-relevant — they don't change anything a webpage's JS
// can observe (navigator.*, WebGL, TLS/HTTP2), only how fast the browser
// process itself comes up — so applying them to both strategies (including
// `baseline`, which is otherwise meant to look "default") doesn't compromise
// baseline's role as the unmodified-fingerprint comparison point.
const FAST_LAUNCH_ARGS = ['--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking'];

export const STRATEGIES = [
  {
    id: 'baseline',
    description: 'Default launch, default navigation, standard viewport — same shape as Discovery\'s own settings. Establishes whether the block is unconditional.',
    launchArgs: [...FAST_LAUNCH_ARGS],
    contextOptions: { viewport: CAPTURE_VIEWPORT },
    waitUntil: 'load',
    navigationTimeoutMs: 20000,
    preDelayMs: () => 0,
    // 1.5s: the `load` event fires once network resources are in, but
    // JS-framework homepages (Angular/React/Vue) still need real time after
    // that to hydrate and paint actual content — 500ms produced a blank
    // white screenshot of Saudia's homepage during V1 validation even
    // though navigation itself succeeded cleanly. This is capture settle
    // time, not a network wait, so it's flat and small regardless of site.
    postSettleMs: 1500,
  },
  {
    id: 'stealth_lite',
    description: 'Hides the most common automation fingerprint (navigator.webdriver via --disable-blink-features=AutomationControlled) and presents a realistic desktop UA.',
    launchArgs: [...FAST_LAUNCH_ARGS, '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
    contextOptions: { userAgent: REALISTIC_USER_AGENT, viewport: CAPTURE_VIEWPORT, locale: 'en-US' },
    // V1 validation finding: this was 'domcontentloaded' (faster than
    // baseline's 'load') on the theory that speed itself was a secondary
    // win. It isn't — the evasion benefit here comes entirely from
    // launchArgs + userAgent, not from which lifecycle event we wait for,
    // and 'domcontentloaded' fires before images/carousels/async widget
    // content (e.g. a geo-resolved origin airport field) load — real case:
    // Saudia's hero carousel and search-widget fields rendered blank under
    // this strategy even though the page itself was genuinely captured
    // (not blocked). 'load' matches baseline's completeness.
    waitUntil: 'load',
    navigationTimeoutMs: 20000,
    preDelayMs: () => 0,
    postSettleMs: 2500,
  },
];
