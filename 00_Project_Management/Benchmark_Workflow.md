# Benchmark Execution Workflow

## Trigger
**"Benchmark [Company]"** or **"Benchmark [URL]"**
The agent executes all steps below. Do not start unless triggered.

---

## Core Principle
This is an **Innovation Repository**, not a screenshot library.
Every benchmark must answer the 5 mandatory questions and produce strategic foresight — not just documentation.

---

## The 5 Mandatory Questions
1. What is the company doing today?
2. Why is this interaction valuable from a UX perspective?
3. What trend does it represent?
4. How could this evolve in the next generation of AI travel experiences?
5. What opportunities does this create for Saudia?

---

## Execution Checklist

### PHASE 1 — SETUP
- [ ] Classify product: Airline / OTA / AI-first / Big Tech / Super App
- [ ] Determine AI maturity level: Absent / Basic / Assistive / Conversational / Autonomous
- [ ] Initialize folder structure
- [ ] Copy `benchmark_metadata_template.json` → fill in company details

### PHASE 2 — CAPTURE

**Capture follows an escalation ladder. Never stop a benchmark because Playwright failed. Downgrade the capture method — never downgrade the analysis.**

---

#### TIER 1 — Playwright Automated Capture (attempt first, always)

For each journey step (01–12):
- [ ] Navigate to the relevant section
- [ ] Screenshot: default / first load state
- [ ] Screenshot: AI thinking / loading state (if AI present)
- [ ] Screenshot: AI response delivered state
- [ ] Screenshot: empty state
- [ ] Screenshot: completed / filled state
- [ ] Video/GIF: any micro-interactions, transitions, motion
- [ ] Video/GIF: context switch between AI and app UI
- [ ] Note voice input availability
- [ ] Note AI memory behavior (does it remember prior context?)
- [ ] Document embedded AI vs. sidebar/chatbot AI
- [ ] Fill `journey_step_template.md` for this step

Steps:
- [ ] 01 Entry
- [ ] 02 Discovery
- [ ] 03 Search
- [ ] 04 AI Interaction ← most important: quote AI verbatim
- [ ] 05 Recommendations
- [ ] 06 Maps
- [ ] 07 Booking
- [ ] 08 Ancillaries
- [ ] 09 Payment ← stop before submission
- [ ] 10 Trip Management
- [ ] 11 Check-in
- [ ] 12 Loyalty

**Common Playwright fixes to attempt before escalating:**
| Symptom | Fix |
|---------|-----|
| `networkidle` timeout | Switch to `domcontentloaded` + `waitForTimeout()` delays |
| Screenshots hanging | Block font CDNs (`fonts.googleapis.com`, `fonts.gstatic.com`); set `timeout: 0` on all `page.screenshot()` calls |
| Bot detection / CAPTCHA | Try headed mode (`headless: false`); add `page.waitForTimeout(2000)` between actions; use a real user-agent string |
| Login wall blocking content | Capture what is publicly visible; mark login-gated content as `[LOGIN-GATED]` in journey step notes |
| SPA hydration delay | Add `page.waitForSelector('[data-testid]')` or equivalent; fall back to 3–5 second delay |
| 404 on guessed URLs | Check source HTML or sitemap for correct paths before giving up |

**Escalation rule:** If Playwright fails on the same page after **2 distinct fix attempts**, do not retry further. Log the failure reason and switch to Tier 2 for that page. If Playwright fails site-wide after 2 script variants, switch fully to Tier 3.

---

#### TIER 2 — Partial Playwright + WebFetch Supplement

When Playwright succeeds on some pages but fails on others:
- [ ] Continue Playwright capture for pages that work
- [ ] For failed pages: use `WebFetch` to retrieve page content (text, structure, visible copy)
- [ ] Extract: headlines, feature descriptions, AI capability claims, pricing, UI copy
- [ ] Label all findings from WebFetch as `[RESEARCHED-WEB]` in journey step files
- [ ] Screenshots not available for failed pages — note `[NO SCREENSHOT — WebFetch only]`

---

#### TIER 3 — Full Hybrid Research Mode

**Triggered when:** Playwright cannot capture any meaningful content after 2 script variants. Reasons include: comprehensive bot detection, mandatory login wall with no public surface, complete site unavailability, or persistent technical failure.

**Hybrid mode is not a degraded benchmark. It is a different capture method. All 11 deliverables are still required.**

##### Step 1 — WebFetch Core Pages
Use `WebFetch` to retrieve and parse:
- Homepage
- Product/features page
- Pricing page (if exists)
- Any AI-specific feature pages discoverable from the homepage HTML
- Blog or press page
- Help / documentation center

##### Step 2 — Web Research
Use `WebSearch` to find:
- `"[Company] AI features [current year]"` — product reviews and walkthroughs
- `"[Company] UX review"` or `"[Company] app walkthrough"` — design breakdowns
- `"[Company] [feature name]"` — for any specific AI capability mentioned on the site
- App Store page URL — search `"[Company] travel app site:apps.apple.com"`
- Google Play page URL — search `"[Company] site:play.google.com"`
- Recent TechCrunch / The Verge / Skift coverage: `"[Company] site:techcrunch.com"`
- Official product YouTube channel or demo videos

##### Step 3 — App Store Intelligence
From the App Store and Google Play pages (via WebFetch):
- Extract: feature descriptions, "What's New" release notes, user review themes, ratings
- Screenshots shown on the store page are public — note what they show
- Release notes reveal AI feature launch cadence

##### Step 4 — Video / Demo Research
Search for:
- Official product demo videos (YouTube, product website)
- Walkthrough videos from tech reviewers
- Conference demos or investor presentations
- Extract: UI patterns visible in video thumbnails or stills, AI interaction demos, feature names

##### Step 5 — News and Announcements
Search for:
- Press releases about AI feature launches
- Funding announcements (reveal product roadmap priorities)
- Partnership announcements (reveal integration strategy)
- Executive interviews about product philosophy

---

#### Evidence Labeling — Required in All Journey Step Files

Every finding in every journey step file must carry one of these labels when not directly observed via Playwright:

| Label | Meaning |
|-------|---------|
| `[OBSERVED]` | Directly captured via Playwright screenshot or interaction |
| `[RESEARCHED-WEB]` | Extracted from the live website via WebFetch |
| `[RESEARCHED-REVIEW]` | Found in a published review, article, or walkthrough |
| `[RESEARCHED-APPSTORE]` | Found on App Store / Google Play page |
| `[RESEARCHED-VIDEO]` | Observed in a product demo or walkthrough video |
| `[INFERRED]` | Reasonably inferred from available evidence; not directly confirmed |
| `[LOGIN-GATED]` | Feature exists but requires login to access; not captured |
| `[APP-ONLY]` | Feature confirmed to exist in the mobile app; not available on web |
| `[NOT FOUND]` | Feature not found via any method; document "feature not present" |

**The Innovation Filter still applies.** Evidence quality affects confidence, not the decision to document. A `[RESEARCHED-VIDEO]` finding of a genuinely innovative AI pattern is worth documenting. A `[OBSERVED]` screenshot of generic UI is not.

---

#### Hybrid Mode — Journey Step Template Modification

When writing journey step files in hybrid mode, add a `## Capture Method` section at the top:

```markdown
## Capture Method
**Mode:** Hybrid Research (Playwright unavailable)
**Playwright failure reason:** [e.g., "Bot detection — CAPTCHA on all pages after headless navigation"]
**Sources used:**
- WebFetch: homepage, /features, /pricing
- App Store page (iOS): [URL]
- Review: [Publication, article title, date]
- Video: [Title, channel, URL]
**Screenshot availability:** None / Partial ([N] screenshots from [source])
**Confidence level:** Medium — core features documented from multiple corroborating sources
```

### PHASE 3 — SCORING
- [ ] Score all 12 steps across 5 dimensions
- [ ] Calculate step averages and overall score
- [ ] Count steps scoring 4+ on Innovation
- [ ] Assign AI maturity level

### PHASE 4 — ANALYSIS
- [ ] Write full UX analysis (template: `ux_analysis_template.md`)
- [ ] Synthesize "What this product believes" statement

### PHASE 5 — PATTERN EXTRACTION
- [ ] Identify every interaction scoring 4+ on Innovation
- [ ] Check pattern library for existing entries
- [ ] Add new patterns or update existing `seen_in` arrays
- [ ] Write `04_emerging_patterns.md` (template: `emerging_patterns_template.md`)
- [ ] Update `06_AI_Trends/pattern_library.json`
- [ ] Flag any pattern seen in 3+ products (emerging trend)

### PHASE 6 — OPPORTUNITIES
- [ ] Write ideas worth adopting
- [ ] Write ideas worth evolving
- [ ] Write ideas to avoid
- [ ] Write 4-tier opportunity brief (Quick Wins / Medium / Long-term / Moonshots)
- [ ] Write "One Big Bet" statement
- [ ] Save `05_innovation_opportunities.md`
- [ ] Save `07_Saudia_Opportunities/[Company]_opportunities.md`

### PHASE 7 — CROSS-BENCHMARK
- [ ] Add scores to `05_UX_Analysis/cross_benchmark_matrix.json`
- [ ] Run delta: what does this do better / worse than field?
- [ ] Update competitive position statements

### PHASE 8 — FIGMA
- [ ] Push journey map (12 steps) to Figma
- [ ] Push innovation callouts
- [ ] Push pattern cards
- [ ] Push Saudia opportunity notes
- [ ] Save `08_Figma/[Company]/annotations.json`

### PHASE 9 — EXECUTIVE SUMMARY + REPORT
- [ ] Write executive summary (template: `executive_summary_template.md`)
  - Answers all 5 mandatory questions
  - One-line verdict
- [ ] Write full benchmark report `00_report.md`
- [ ] Update `metadata.json` with all paths and completion status
- [ ] Mark all 11 deliverables complete in `metadata.json`

---

## 11 Deliverables Checklist
- [ ] 01 Executive Summary
- [ ] 02 User Journey (12 step files)
- [ ] 03 Screenshots (organized by step)
- [ ] 04 UX Analysis
- [ ] 05 Innovation Score (in metadata.json)
- [ ] 06 Emerging UX Patterns
- [ ] 07 Ideas Worth Adopting
- [ ] 08 Ideas Worth Evolving
- [ ] 09 Ideas to Avoid
- [ ] 10 Saudia Opportunities (4-tier)
- [ ] 11 Figma Annotations

---

## Queue Integration (Dashboard)

If this benchmark originated from a Wizard request in the dashboard (check
`AI_Travel_Benchmark_2026/Benchmark_Requests.json` for a `queued` item matching this
company), call the CLI hook below at each phase boundary so the dashboard's Queue page
reflects real progress instead of sitting on "Queued" the whole time:

```
node scripts/update_queue.js <requestId> <slug> <stage>
```

| Execution phase | Queue stage |
|---|---|
| Before starting PHASE 1 — SETUP | `preparing` |
| First navigation in PHASE 2 — CAPTURE | `opening_website` |
| Once screenshots for most journey steps are captured | `capturing_screenshots` |
| PHASE 3 — SCORING / PHASE 4 — ANALYSIS | `analyzing_ux` |
| PHASE 5 — PATTERN EXTRACTION | `extracting_patterns` |
| PHASE 7 — CROSS-BENCHMARK (matrix JSON updated + `generate_matrix.js` run) | `updating_matrix` |
| PHASE 8 — FIGMA | `generating_dashboard` |
| PHASE 9 — EXECUTIVE SUMMARY + REPORT complete | `completed` |

If no matching request exists (a benchmark run without going through the Wizard), skip
this — it's optional bookkeeping, not a required deliverable.

---

## Benchmark Backlog (Innovation-First Order)

### Tier 1 — AI Pioneers (benchmark first)
| # | Company | Category | Why First |
|---|---------|----------|-----------|
| 1 | Mindtrip | AI-first | Most AI-native travel planner — defines the ceiling |
| 2 | Google Travel + Gemini | Big Tech | AI at scale — sets the baseline expectation |
| 3 | Trip.com | OTA | Most technologically aggressive OTA with full AI planner |
| 4 | Layla | AI-first | Conversational AI specialist — strong on intent parsing |
| 5 | Roam Around | AI-first | Automated itinerary AI — fast, opinionated |

### Tier 2 — Established Innovators
| # | Company | Category | Why This Order |
|---|---------|----------|----------------|
| 6 | Airbnb | OTA | Best personalization and discovery UX in travel |
| 7 | Booking.com | OTA | AI assistant "Penny" — largest OTA AI deployment |
| 8 | Expedia | OTA | ChatGPT integration — shows LLM in legacy OTA |
| 9 | Kayak | OTA | Strong AI price prediction and multimodal search |

### Tier 3 — Digital-Forward Airlines
| # | Company | Category | Why This Order |
|---|---------|----------|----------------|
| 10 | Emirates | Airline | Gold standard airline digital — highest quality bar |
| 11 | Singapore Airlines | Airline | Sophisticated digital + Kris loyalty AI |
| 12 | Turkish Airlines | Airline | Miles&Smiles + strong ancillary AI |
| 13 | Qatar Airways | Airline | Oryx loyalty + strong booking UX |

### Tier 4 — Super Apps & Wild Cards
| # | Company | Category | Why |
|---|---------|----------|-----|
| 14 | Grab | Super App | Travel in super app — relevant for SE Asia / emerging market lens |
| 15 | Naver Travel | Super App | South Korea — advanced AI integration in super app |

---

## Priority Rationale
Start with AI-first products because:
1. They define what "AI-powered travel" means — not incumbents catching up
2. They produce the most innovation patterns per benchmark
3. They calibrate the Innovation Score ceiling for all subsequent benchmarks
4. They reveal where the industry is heading, not where it is

Benchmark airlines after AI-first products so Saudia can be evaluated against the right future standard — not just the current airline standard.
