# Capture manually (assisted capture)

**Why:** airline sites (Emirates, Qatar Airways, Saudia…) sit behind Akamai /
Imperva / Cloudflare bot protection. The run history showed every Qatar
Airways run and the Emirates run "succeeding" on an *Access Denied* page.
A real person in a real browser gets through; automation does not.

**What it does:** a visible browser window opens on your computer (your
installed Google Chrome when available) with a small *Benchmarq capture*
toolbar. You click through to the page (search, pick a fare, type dummy
passenger data — never real data, never pay), scroll the part you want
analysed into view, and press **Capture this page**. From there the normal
pipeline runs unchanged: Vision → Reasoning → Report → completion gate.

The capture is refused (with a message in the toolbar) if the page is on
another domain or is a bot-protection page — solve the check, then capture
again. Cookie/consent choices are remembered per company in
`.assisted-browser-profile/` (git-ignored).

## How to use

1. Run the dashboard **locally**: `npm start` (it can't open a window on the
   hosted server — the run fails with a clear message there).
2. New Benchmark → Review → *How should we reach the page?* → **I'll navigate
   myself**. One window opens per company.
   Or, on any failed run in Activity → **Capture manually**.
3. Activity shows *Waiting for you in the capture window* until you capture.
   Closing the window, Cancel, or 15 minutes without a capture fails the run
   with a plain message; press Capture manually to try again.

Env: `ASSISTED_CAPTURE_TIMEOUT_MS` (default 900000),
`ASSISTED_CAPTURE_CHANNEL` (`chrome` default, `msedge`, or `chromium`).

## Also fixed in the same change

- **Bot-block pages are no longer "success".** `runtime/pageBlockDetector.js`
  checks every captured step (URL + visible text, reusing the Anti-Bot
  signatures). A run that only reached a block page fails fast as
  *"This website blocked the automated browser…"* — no Vision / Reasoning spend.
- **Every competitor in a benchmark now runs.** The duplicate-run lock was
  request-wide, so in "Saudia vs Emirates vs Qatar" only the first company
  ever started. It is now per company.
