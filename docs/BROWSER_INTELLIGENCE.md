# Browser Intelligence Research (Sprint 15)

**Research only — nothing in this document has been implemented.** No code
was written or modified to produce it.

## Why this research exists

Sprint 14's live re-run of the same 6 airlines from Sprint 13, now behind a
purpose-built Smart Anti-Bot Layer (4 fallback strategies: stealth launch
flags, alternate `waitUntil` modes, slower navigation, randomized delay),
still failed on all 6 — 3 of them (Etihad, Turkish Airlines, Air France)
with `net::ERR_HTTP2_PROTOCOL_ERROR` on **every one of 12 real attempts each**
(4 strategies × 3 scheduler retries), with **no HTTP response ever received**.
That's not a fixable-by-flags problem — it's a rejection at the TLS/HTTP2
layer, before any page loads. This research exists to answer: given that
finding, what's actually capable of getting past it, and what should this
project use going forward?

---

## Option 1 — Playwright (self-hosted, current setup)

- **Success rate:** Fine against sites with no serious bot management (this project's own history bears this out — Booking.com, Trip.com, ixigo, Mindtrip all benchmarked successfully with plain Playwright). Against enterprise-tier Cloudflare/Akamai, effectively **0%** for the hardest cases — exactly what Sprint 14 measured.
- **Cloudflare handling:** None built in. Stealth patches (disabling `navigator.webdriver`, spoofing plugins/WebGL) only fix the cheapest fingerprint checks. Cloudflare now requires a matching TLS fingerprint *and* a real residential IP; a stealth-patched Playwright session on a datacenter IP reportedly passes **~5% of Cloudflare Pro challenges and 0% of Enterprise** in independent 2026 testing.
- **HTTP2 handling:** This is the actual root cause of Sprint 14's hard failures. Playwright's bundled Chromium has a JA3/TLS fingerprint and HTTP/2 SETTINGS-frame ordering that **doesn't match any real Chrome release** — Akamai and Cloudflare both fingerprint at this layer now, ahead of JavaScript, so the connection can be rejected before a single byte of the page is served. No amount of `waitUntil`/launch-flag tuning touches this, because it isn't a page-rendering problem.
- **CAPTCHA handling:** None. Would need a third-party solver bolted on.
- **Cost:** $0 licensing. Real cost is engineering time (Sprint 14 spent a full sprint on this) plus compute.
- **Ease of integration:** Already fully integrated — this is the current stack.
- **Suitability for our Benchmark Engine:** Good default for the majority of targets (most OTAs, most AI-first products). **Provably insufficient alone** for legacy full-service airlines running enterprise bot management — that's not a configuration gap, it's an architectural ceiling.

## Option 2 — Browserbase

- **Success rate:** Reports ~92% on reCAPTCHA v2, ~88% on hCaptcha, ~95% on Cloudflare Turnstile solving specifically (Basic Stealth tier).
- **Cloudflare handling:** Two tiers. Basic Stealth randomizes fingerprints/viewports and solves visual CAPTCHAs. **Advanced Stealth** (Scale plan only) runs a custom-maintained Chrome build built specifically to resist detection, and **Browserbase Identity** — currently in beta, Scale plan only — is a genuine architectural differentiator: cryptographically-signed sessions recognized directly by Cloudflare through Browserbase's participation in Cloudflare's own **Signed Agents program**, rather than trying to look human at all.
- **HTTP2 handling:** Not published as a discrete metric, but the custom Chrome build + Signed Agents path is specifically aimed at exactly the TLS/HTTP2-layer rejection Sprint 14 hit, since it sidesteps fingerprint-matching entirely for participating sites.
- **CAPTCHA handling:** Automatic for reCAPTCHA v2, hCaptcha, and Cloudflare Turnstile (see success rates above).
- **Cost:** $20/mo entry tier, $99/mo mid, custom Scale (required for Advanced Stealth + Identity). Proxy traffic billed separately: ~$8/GB residential, ~$0.30/GB stealth datacenter.
- **Ease of integration:** Connects over CDP — `chromium.connectOverCDP(wsEndpoint)` — meaning Discovery/Vision's existing `chromium.launch()` calls could be swapped for a remote connection with minimal code change and zero change to what happens *after* the browser is connected.
- **Suitability:** Strong fit if the Cloudflare-specific cases (Lufthansa's pattern in Sprint 14 — genuine Cloudflare challenge, sometimes passed) are the priority. The Signed Agents angle is the most forward-looking Cloudflare-specific approach of everything researched here, but Advanced Stealth/Identity gating behind the Scale plan raises the real cost for our specific failure mode.

## Option 3 — Steel Browser

- **Success rate:** Not independently published; vendor reports 800B+ tokens scraped / 800K+ browser-hours served in production.
- **Cloudflare handling:** Built-in fingerprint stealth + rotating residential proxies + `solveCaptcha`, which explicitly supports Cloudflare Turnstile alongside hCaptcha, image-to-text, AWS WAF, and reCAPTCHA v2/v3.
- **HTTP2 handling:** Not called out as a discrete capability in vendor docs — bundled into "browser fingerprint management," which per the general research above is necessary but not sufficient against Enterprise-tier TLS/HTTP2 fingerprinting on its own.
- **CAPTCHA handling:** Broadest documented CAPTCHA coverage of any option here (Turnstile, hCaptcha, image-to-text, AWS WAF, reCAPTCHA v2/v3).
- **Cost:** Free Hobby tier (100 browser-hours/mo) for evaluation. Paid cloud: $29/mo Starter, $99/mo Developer, $499/mo Startup. **Apache 2.0 self-hostable** — the only option here with a genuine no-cost, no-vendor-lock-in path.
- **Ease of integration:** Explicitly designed as a drop-in for Playwright/Puppeteer/Selenium — same CDP-connection model as Browserbase, described by the vendor as "one-line migration."
- **Suitability:** The best-value evaluation candidate — free self-hosted tier means we could test it against our actual failing 6 airlines at zero cost before committing budget, and the open-source core avoids vendor lock-in if we later want to run it ourselves at scale.

## Option 4 — Bright Data Browser API (Scraping Browser / Web Unlocker)

- **Success rate:** Not independently benchmarked in the sources found, but Bright Data is the most established vendor here (formerly Luminati, largest proxy network in the industry) and is frequently cited as a baseline in third-party comparisons.
- **Cloudflare handling:** The **Web Unlocker** product specifically targets Cloudflare/DataDome-class defenses and uses a **pay-only-for-success** pricing model — failed attempts cost nothing, which directly de-risks trying it against our known-hard airline set.
- **HTTP2 handling:** Bundled into Web Unlocker's "automatic website unlocking" — includes CAPTCHA solving, fingerprinting, and automatic retries as one managed operation, i.e., they own the TLS/HTTP2 fingerprint-matching problem so we don't have to.
- **CAPTCHA handling:** Included as part of Web Unlocker's managed unlocking flow.
- **Cost:** Scraping Browser (raw CDP browser): ~$5/GB, or ~$7/GB effective on the $499/mo entry plan (71GB included). Web Unlocker (the higher-level, pay-per-success API): ~$1–3 per 1,000 successful responses depending on source. For a low-volume internal benchmark tool, **Web Unlocker's per-success pricing is the more cost-predictable of the two**, since raw proxy/browser setups can fail 30–40% of requests against exactly this class of target, and Bright Data doesn't charge for those failures.
- **Ease of integration:** Scraping Browser connects over CDP like Browserbase/Steel. Web Unlocker is a higher-level HTTP API (send a URL, get back unlocked HTML) — a bigger integration change than a CDP swap, since it doesn't hand back a live Playwright `Page` object the way Discovery's code currently expects.
- **Suitability:** The strongest evidence-to-cost ratio for our *specific* failure mode (hard TLS/HTTP2/Cloudflare/Akamai rejection) because of the pay-for-success model and the largest, most mature proxy network in the industry backing the IP-reputation side of the problem — which is the one dimension none of our Sprint 14 in-house strategies could ever touch.

## Option 5 — Scrapeless Browser

- **Success rate:** Vendor-claimed >99% in case studies; not independently verified in the sources found.
- **Cloudflare handling:** AI-driven anti-detection combined with a managed headless browser; explicitly lists Cloudflare among supported CAPTCHA/challenge types solved automatically.
- **HTTP2 handling:** Not separately documented — folded into the general "anti-detection" claim.
- **CAPTCHA handling:** reCAPTCHA, Cloudflare, OCR-based CAPTCHAs, described as AI-powered.
- **Cost:** Positioned explicitly as the low-cost option in this category ("most affordable... CAPTCHA solver on the market"), pay-as-you-go with volume discounts. Exact rate card wasn't published in the sources found.
- **Ease of integration:** Same category as Steel/Browserbase (managed browser + CDP), similar integration shape.
- **Suitability:** The newest, least-independently-verified vendor of the group. Worth a cheap pilot given the low advertised cost, but I'd weight its claims lower than Bright Data's or Browserbase's until tested against our own 6 known-hard airlines, precisely because none of its performance claims in the sources found are independently sourced.

## Option 6 — Chrome Stable (real Chrome, not Chromium)

- **Success rate / Cloudflare / HTTP2:** Materially better starting point than Playwright's bundled Chromium purely on fingerprint grounds — a real Chrome Stable build's TLS/JA3 and HTTP/2 SETTINGS-frame signature genuinely matches what Cloudflare/Akamai expect from a real user, unlike Playwright's own Chromium build. As of Playwright 1.57, Playwright can drive **Chrome for Testing** (Google's own dedicated automation-safe Chrome distribution) via the `channel: 'chrome'` option, which is closer to real Chrome than default Chromium. This closes part of the fingerprint gap but **does not solve IP reputation or behavioral analysis** — the CDP connection itself, and running headless/automated at all, remain separately detectable signals.
- **CAPTCHA handling:** None built in — same gap as plain Playwright.
- **Cost:** Free.
- **Ease of integration:** Trivial — one flag (`{ channel: 'chrome' }`) in the existing `chromium.launch()` calls inside Discovery/Vision. This is the **cheapest possible next experiment** given Sprint 14's findings, and notably requires no new vendor and no budget approval.
- **Suitability:** Worth trying **before** any paid vendor, specifically against the 3 hard-HTTP2-failure airlines, since it's a same-day, zero-cost test of whether the fingerprint mismatch alone (rather than IP reputation) was the dominant cause.

## Option 7 — Microsoft Edge

- **Success rate / Cloudflare / HTTP2:** Chromium-based, so shares Chrome's general fingerprint profile, but is a *less common* automation target — some anti-bot training data and heuristics skew toward detecting Chrome/Chromium specifically, so Edge can occasionally see modestly lower scrutiny purely from being less-tested by attackers building evasion tools (and, symmetrically, less tested by us).
- **CAPTCHA handling:** None built in.
- **Cost:** Free.
- **Ease of integration:** Playwright supports Edge via `channel: 'msedge'`, same trivial swap as Chrome Stable.
- **Suitability:** A reasonable second free experiment alongside Chrome Stable, but there's no strong evidence in the research above that it meaningfully outperforms Chrome Stable against Enterprise-tier TLS/HTTP2 fingerprinting — the underlying Chromium engine and CDP detection surface are shared.

## Option 8 — Firefox

- **Success rate / Cloudflare / HTTP2:** Genuinely different engine, not just a Chromium reskin — different base fingerprint entirely, which research specifically calls out as valuable *because* most bot-detection training data and stealth tooling skews toward Chromium. Firefox reportedly scores best among automation-tool fingerprints in independent testing. Firefox-based tools like Camoufox go further, patching at the C++ level to randomize fingerprints per session.
- **CAPTCHA handling:** None built in natively; would need the same third-party bolt-on as any option here.
- **Cost:** Free. Camoufox (if adopted) is also open-source.
- **Ease of integration:** Playwright supports Firefox natively (`playwright.firefox.launch()`) — no code restructuring needed, since Discovery/Vision already only depend on the generic Playwright `Page` API, not Chromium-specific behavior. **Important limitation:** stealth plugins (`playwright-extra` etc.) are Chromium-only and do **not** work with Firefox — any fingerprint patching would need a Firefox-specific tool like Camoufox instead.
- **Suitability:** The most interesting **free** option precisely because it sidesteps the "does my Chromium fingerprint match a real Chrome" problem entirely by not claiming to be Chrome at all. Worth testing directly against the 3 hard-failure airlines alongside Chrome Stable — different failure signatures between the two would be diagnostically useful even if neither fully solves it.

---

## Comparison Table

| Option | Cloudflare | HTTP2/TLS fingerprint | CAPTCHA | Cost (low-volume internal use) | Integration effort | Fixes Sprint 14's actual failures? |
|---|---|---|---|---|---|---|
| Playwright (current) | ✗ | ✗ (root cause of the 3 hard failures) | ✗ | Free | Already done | No |
| Browserbase | ✅✅ (Signed Agents beta) | Partial (bypasses via trust, not matching) | ✅ (92-95%) | $20-99/mo + proxy GB, Advanced tier = Scale plan | Low (CDP swap) | Likely, for Cloudflare cases |
| Steel Browser | ✅ | Partial | ✅ (broadest coverage) | Free self-hosted / $29+/mo cloud | Low (CDP swap) | Possibly — cheapest to test |
| Bright Data (Web Unlocker) | ✅✅ | ✅✅ (owns IP reputation too) | ✅ | ~$1-3/1K successes, pay-for-success | Medium (HTTP API, not CDP) | Most likely of all paid options |
| Scrapeless | ✅ (claimed) | Unverified | ✅ (claimed) | Lowest advertised, unverified | Low (CDP swap) | Unknown — needs a pilot |
| Chrome Stable | Partial (fingerprint only) | Partial (fingerprint only) | ✗ | Free | Trivial (`channel: 'chrome'`) | Worth testing first, free |
| Microsoft Edge | Partial (fingerprint only) | Partial (fingerprint only) | ✗ | Free | Trivial (`channel: 'msedge'`) | Unclear, marginal vs. Chrome |
| Firefox | Different profile, not "beat" | Different profile, not "beat" | ✗ | Free | Trivial (native Playwright) | Worth testing, free, diagnostic value |

---

## Recommended Architecture: Tiered Escalation, Not Wholesale Replacement

**Do not replace Playwright.** Most of this project's targets don't need any
of this — Sprint 14's own antibot module and the underlying Discovery/Vision/
Reports/Scheduler pipeline work fine against sites without enterprise bot
management, and paying managed-browser rates for every single benchmark run
would be spending real money to solve a problem that only affects a minority
of targets.

**Recommended shape:**

```
Anti-Bot Layer (existing, Sprint 14)
   │
   ├─ probe succeeds (clean read) ──────────────▶ Discovery runs normally, $0 extra cost
   │
   └─ probe exhausts all 4 strategies AND
      classification is network_error / http2_protocol_error
      / vendor_present_uncertain (the exact signatures Sprint 14
      proved plain Playwright cannot fix)
            │
            ▼
      Escalate ONLY this company to a managed Browser API
      via CDP (chromium.connectOverCDP), reusing the same
      Discovery/Vision/Reports code downstream — those modules
      only need a live Page object, they don't care how it was
      obtained
```

1. **Free experiment first, before any spend:** add `channel: 'chrome'` and a Firefox pass as two more probe strategies inside the existing Anti-Bot Layer (this is a config change to `strategies.js`, not a new architecture) and re-run against the 3 confirmed hard failures. Given the research above, this could plausibly resolve Etihad/Turkish/Air France at zero cost, since their failure signature is exactly what a real-Chrome or non-Chromium fingerprint targets.
2. **If that's insufficient, escalate — don't replace.** For companies where the Anti-Bot Layer still can't get a clean read even with real Chrome/Firefox added, connect to **Bright Data's Web Unlocker** as the fallback, specifically because of its pay-only-for-success pricing (aligned with our low, bursty internal usage pattern) and because it's the one option researched here that owns *both* halves of what actually blocked us — TLS/HTTP2 fingerprint matching *and* IP reputation, not just one or the other.
3. **Keep Browserbase (Advanced Stealth / Signed Agents) as the named second choice**, specifically for Cloudflare-flavored failures like Lufthansa's (where our own data showed 2 of 4 attempts already got a clean HTTP 200 past the challenge) — its Cloudflare-specific partnership is the most architecturally interesting approach found, but the Advanced tier's Scale-plan gating makes it a worse fit than Bright Data for a low-volume internal tool today.
4. **Steel Browser is the recommended pilot vehicle**, not the production fallback: its free self-hosted tier means we can validate steps 2-3's actual success rate against our real 6-airline failure set at zero cost before committing budget to Bright Data or Browserbase.

This keeps every existing module — Discovery, Navigation Runner, Vision
Analysis, Reports, the Scheduler, and the Sprint 14 Anti-Bot Layer —
completely untouched. The only new integration point is where
`chromium.launch()` gets its browser from, and only for the minority of
companies that provably need it.

---

## Sources

- [Stealth Mode - Browserbase Documentation](https://browserbase.mintlify.app/features/stealth-mode)
- [Browserbase Pricing](https://www.browserbase.com/pricing)
- [How to Bypass Cloudflare when Web Scraping (2026) | ScrapeOps](https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/)
- [How to Bypass Cloudflare when Scraping: The 8 Best Methods - ZenRows](https://www.zenrows.com/blog/bypass-cloudflare)
- [Steel | Open-source Headless Browser API](https://steel.dev/)
- [GitHub - steel-dev/steel-browser](https://github.com/steel-dev/steel-browser)
- [Captcha Solving | Steel Docs](https://docs.steel.dev/overview/stealth/captcha-solving)
- [Pricing/Limits | Steel Docs](https://docs.steel.dev/overview/pricinglimits)
- [Steel.dev Pricing 2026 | costbench](https://costbench.com/software/browser-automation/steel-dev/)
- [Bright Data Pricing 2026 Guide | Use Apify](https://use-apify.com/blog/bright-data-pricing-guide-2026)
- [Web Unlocker Pricing Plans - Bright Data](https://brightdata.com/pricing/web-unlocker)
- [Scraping Browser Pricing - Bright Data](https://brightdata.com/pricing/scraping-browser)
- [Bright Data Pricing 2026 | Costbench](https://costbench.com/software/web-scraping/bright-data/)
- [CAPTCHA solver API pricing and success rate comparison - Scrapeless](https://www.scrapeless.com/en/wiki/captcha_solver_api_pricing_and_success_rate_comparison)
- [CAPTCHA Solving | Scrapeless Scraping Browser Docs](https://docs.scrapeless.com/en/scraping-browser/features/advanced-privacy-anti-detection/supported-captchas/)
- [Playwright Stealth: Bypass Bot Detection in Python & Node.js - Scrapfly](https://scrapfly.io/blog/posts/playwright-stealth-bypass-bot-detection)
- [Playwright Anti-Bot Detection: What Works (2026) | AlterLab](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)
- [Playwright Cloudflare Bypass 2026: 3 Methods That Still Work (9 Don't)](https://humanbrowser.cloud/blog/bypass-cloudflare-playwright-2026)
- [Camoufox vs. Rebrowser vs. Stock Playwright: A Fingerprint Benchmark - Evomi](https://evomi.com/blog/camoufox-vs.-rebrowser-vs.-stock-playwright-a-fingerprint-benchmark)
- [How to Avoid Bot Detection with Playwright | BrowserStack](https://www.browserstack.com/guide/playwright-bot-detection)
- [TLS Fingerprinting: How It Works & How to Bypass It - Browserless](https://www.browserless.io/blog/tls-fingerprinting-explanation-detection-and-bypassing-it-in-playwright-and-puppeteer)
- [Browsers | Playwright](https://playwright.dev/docs/browsers)
- [Chrome for Testing vs Chromium in Playwright (2026 Guide)](https://qaskills.sh/blog/chrome-for-testing-vs-chromium-playwright)
- [Headless Browser Detection: Signals, Methods, and What Works in 2026 - cside](https://cside.com/blog/headless-browser-detection)
- [Akamai Bot Manager Bypass: Complete Guide (2026) - Sendwin](https://blog.send.win/akamai-bot-manager-bypass-complete-guide-2026/)
- [How to Bypass Akamai when Web Scraping in 2026 - Scrapfly](https://scrapfly.io/blog/posts/how-to-bypass-akamai-anti-scraping)
- [Bypass Akamai Bot Manager | Scrapfly](https://scrapfly.io/bypass/akamai)
