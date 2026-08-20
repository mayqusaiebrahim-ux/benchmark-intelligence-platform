# Navigation capability

Driving a browser against a live product: bot-wall probing, structural discovery,
screenshot capture, multi-step journey execution, and (Sprint 19) plain navigation.

**Default provider: `PlaywrightNavigationProvider`**, a thin facade over four
existing, unmodified entry points in `11_Benchmark_Engine/modules/`, plus one
method (`navigate()`) with real Playwright logic of its own:

| Method | Delegates to |
|---|---|
| `probe(url, opts)` | `modules/antibot/index.js` → `probeUrl` |
| `discover(input)` | `modules/discovery/index.js` → `runDiscovery` |
| `captureScreenshot(input)` | `modules/vision/screenshotRunner.js` → `captureScreenshot` |
| `runJourney(input)` | `modules/navigation_runner/index.js` → `runJourney` |
| `navigate(url, opts)` | `BrowserSessionManager.js` (this folder) — see below |

No browser automation logic lives in this folder for the first four methods —
Playwright is (and, for now, the only) implementation of the Navigation contract,
but nothing here is coupled to Playwright by name; a future non-Playwright provider
(e.g. a hosted browser API) would only need to implement the same five methods.

## `BrowserSessionManager.js` (Sprint 23 — Shared Browser Session)

`navigate()`'s own browser creation/closing goes through `createBrowserSession()`/
`closeBrowserSession()` in this folder — the one place `chromium.launch()` is
called for a Runtime-driven (Navigation Stage → Screenshot Stage) session.
`PlaywrightScreenshotProvider.js` (`12_Provider_Layer/capabilities/screenshot/`)
imports `closeBrowserSession()` from here too, since it's the last consumer of
that same session and owns closing it once capture finishes.

**Deliberately not consolidated this sprint:** `probe()` (Anti-Bot — launches a
fresh browser per fallback strategy, by design) and `discover()` (Discovery — its
own separate navigation after the probe is a documented, production-tested safety
check, not an accidental duplicate). Neither goes through
`BrowserSessionManager.js`. See the Sprint 23 report for the full reasoning.
