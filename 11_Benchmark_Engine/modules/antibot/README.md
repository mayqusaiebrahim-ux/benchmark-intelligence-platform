# Anti-Bot Layer (Sprint 14)

Runs **before** Discovery, in its own independent Playwright session.
Discovery, Reports, the Scheduler, and the Dashboard are all unmodified —
this module only decides, ahead of time, whether it's worth running
Discovery at all, and produces a diagnostic report when it isn't.

## Files

| File | Role |
|---|---|
| `signatures.js` | Pattern library — network error regexes, HTTP status classifications, content signatures for Cloudflare/Akamai/PerimeterX/CAPTCHA/generic challenges. Pure data. |
| `detectors.js` | `classifyNetworkError(err)` and `classifyResponse({status, headers, title, bodyText})` — pure classification functions, no browser code. |
| `strategies.js` | Four ordered browser configurations (launch flags, `waitUntil` mode, navigation speed, randomized delay) tried in sequence. |
| `probe.js` | `probeUrl(url, { onAttempt })` — runs the strategies in order, stops at the first clean read or the first permanent classification. |
| `protectionReport.js` | `writeProtectionReport(...)` — saves a Protection Detection Report (`report.json` + `report.md`) to `02_Benchmark_Repository/_Protection_Reports/{slug}/`. |
| `index.js` | Public exports, matching the other `modules/*/index.js` convention. |

## The honest constraint

This layer **cannot inject its winning strategy into Discovery's own
navigation** — `modules/discovery/index.js` always launches its own fresh,
vanilla `chromium.launch()` internally, and per Sprint 13/14's requirements
it stays that way, unmodified. So this is a **pre-flight gate**, not a
request interceptor:

- If every strategy fails and the first failure is classified **permanent**
  (DNS doesn't resolve, a TLS/cert error, explicit "you've been banned"
  language), the probe aborts immediately, writes a Protection Detection
  Report, and **Discovery is never called** for that attempt — no point
  spending 60-90s on a Discovery + Vision cycle that would almost certainly
  hit the exact same wall.
- If every strategy fails but none was individually permanent, that's still
  reported and Discovery is skipped for *this* attempt — but the job as a
  whole is still eligible for the Scheduler's own unmodified retry policy,
  which will re-run the probe fresh after backoff. A rate- or timing-based
  block may have cleared by then; a fingerprint-based one likely won't.
- If a strategy **does** get a clean read, the probe hands off to Discovery
  immediately. This is a real, meaningful pre-check (it proves the site is
  reachable and not hard-blocking at that moment) but not a guarantee —
  Discovery's own separate, vanilla navigation moments later could still
  land differently. What this layer removes is wasted cycles on the cases
  that were never going to work; it cannot rewrite how Discovery itself
  talks to the site.

## Retry philosophy ("retry only when meaningful")

| Situation | Action |
|---|---|
| DNS failure, TLS/cert error, explicit ban language | Stop after strategy 1 — permanent |
| Cloudflare/Akamai/PerimeterX challenge page, generic CAPTCHA, `ERR_HTTP2_PROTOCOL_ERROR`, timeout | Keep trying remaining strategies — plausibly flag/timing-sensitive |
| A later strategy gets a clean read | Stop immediately, proceed to Discovery |
| All 4 strategies exhausted, none clean, none individually permanent | Stop, report, let the Scheduler's own retry decide about a later attempt |
