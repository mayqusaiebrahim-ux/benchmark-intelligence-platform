# Discovery Agent — understand an unknown site, don't benchmark it

**Given only a URL, produce a Discovery Report.** This module's job is to figure out
what kind of travel product this is and where things are — never to score it, capture
its full journey, or perform any transaction. That's Vision, Analysis, and Reports'
job, in that order, once Discovery hands off.

## Allowed — safe, reversible, non-transactional

- Open the homepage, wait for it to render.
- Dismiss a cookie/consent banner, if a recognizable Accept-style control exists.
- Expand a collapsed navigation menu, if a recognizable toggle exists.
- Observe: AI widgets, search forms, login/account links, language selectors,
  visible CTAs, page copy.

Both actions are bounded to **at most one click each, once per run**, and only fire
when a target is confidently identified. Discovery never loops, never retries a
click, and never chases a second page.

## Never allowed

Search flights, submit any form, start a booking, log in, check out, enter passenger
data, or perform any transaction of any kind. The click-target logic in `actions.js`
checks every candidate against a transactional-keyword denylist immediately before
clicking, on top of only ever considering two narrow categories of control in the
first place (consent-accept, menu-toggle).

## Why there are no hardcoded selectors

Earlier iterations of this module detected cookie banners and chat widgets by
matching known vendor markup (`#onetrust-banner-sdk`, `.intercom-launcher`, …).
That only works for the specific products it was written against — it tells you
nothing about a site using a different (or homegrown) implementation, which defeats
the point of a platform meant to benchmark *any* travel site.

Every detector here instead relies on conventions that hold regardless of vendor:

- **Structural** — CSS `position: fixed`/`sticky`, element geometry (a banner spans
  most of the viewport width and pins to an edge; a chat launcher is small and
  corner-anchored).
- **Semantic/ARIA** — `aria-expanded`, `aria-controls`, `aria-label`, `role`,
  standard tags (`nav`, `header`, `footer`).
- **Content-based** — visible text matched against pattern dictionaries (cookie/
  consent language, accept-button phrasing, AI/assistant keywords).

When Discovery decides to click something, the target is located at runtime by the
**accessible name it just observed on this page** (`actions.js`'s
`locateByAccessibleName`, via Playwright's `getByRole`/`getByText`) — never a fixed
selector string written in advance for a known product.

## File layout

- `signals.js` — the only file that reads DOM state. One `page.evaluate()` pass per
  observation; purely read-only, reports candidates but never clicks.
- `actions.js` — the only file that clicks anything. Consumes the candidates
  `signals.js` found, re-validates each against the transactional denylist, and
  performs at most one dismiss + one expand.
- `interpret.js` — pure functions, no browser access: turns raw signals plus
  whatever actions were actually taken into the report's classified sections, and
  makes the rule-based decisions (`safe_next_action`, `suggested_benchmark_journey`,
  overall `confidence`).
- `index.js` — the agent loop: observe → decide + act (once) → re-observe if
  anything changed → interpret → return the report.

## How later modules consume this

- **Vision** takes `suggested_benchmark_journey` instead of requiring a human to
  supply `journey_steps` up front, and reads `obstacles`/`consent_status` to decide
  whether to escalate up the existing Tier 1/2/3 capture ladder before it even starts.
- **Reports** can cite `website_type`, `primary_user_goals`, and `obstacles` directly
  in the executive summary and evidence labeling (e.g. `LOGIN-GATED`).
- The orchestrator reads `safe_next_action` as its literal next instruction to Vision.
