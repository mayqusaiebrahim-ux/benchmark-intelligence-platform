# Screenshot capability

Capturing full-page and viewport screenshots from an already-open browser session —
never launches a browser, never navigates. That work belongs to the Navigation
capability; Screenshot only exists to reuse what Navigation already produced.

**Default provider: `PlaywrightScreenshotProvider`**. Takes a live `page`/`browser`
(handed off from `PlaywrightNavigationProvider.navigate(url, {keepOpen:true})` via
`13_Orchestrator`'s Runtime, not through this registry), captures a viewport
screenshot then a full-page screenshot, and closes the browser when done — it is the
last capability in the pipeline that ever touches that session.

Storage reuses the existing, already-exported `SCREENSHOTS_DIR` convention from
`11_Benchmark_Engine/modules/vision/screenshotRunner.js` (`03_Screenshots/`, flat
files, `{slug}_{timestamp}_{fullpage|viewport}.png`) — the only currently-live,
code-driven single-shot screenshot convention in this codebase. No new storage
format or folder layout is introduced.
