# Provider Layer — AI Provider Independence

> **Sprint 15.** The platform is an AI Benchmark Platform, not a Claude application —
> Claude is one possible provider among several. This folder is the seam that makes
> every other part of the platform ask for a **capability** (Navigation, Vision,
> Reasoning, Reports, Embeddings) instead of a **vendor** (Claude, OpenAI, Gemini, ...).

## Why this folder, and not inside `10_Dashboard/` or `11_Benchmark_Engine/`

`11_Benchmark_Engine/` is explicitly frozen (see its own README banner) — no new
capabilities are being added there. `10_Dashboard/lib/providers/` already correctly
hosts the Reasoning seam (`AgentProvider`/`ClaudeProvider`), and the only existing
cross-folder import edge runs one way: `10_Dashboard/` → `11_Benchmark_Engine/`.
Putting the Capability Layer in either folder would mean inverting that edge, moving
working files, or splitting a capability's interface from its implementation across
two "frozen" or otherwise off-limits locations.

Instead, `12_Provider_Layer/` is a new sibling both sides import **downward** into.
Nothing in `10_Dashboard/` or `11_Benchmark_Engine/` is modified by this sprint.

```
Dashboard (10_Dashboard)          Benchmark Engine (11_Benchmark_Engine)
        │                                    │
        │   both import downward only — never across, never up
        ▼                                    ▼
        └──────────────► 12_Provider_Layer/ ◄──────────────┘
```

## Philosophy

The engine asks for a capability, never a model.

```
Bad:  runClaude()             Good:  reasoningProvider.run()
Bad:  claudeVision()          Good:  visionProvider.analyze()
```

## Scope of this sprint

This sprint implements **only the architecture**: one interface per capability, and —
where a working implementation already exists in this codebase — a thin default
provider that *delegates* to it (zero reimplemented logic). It does **not**:

- Implement any provider that doesn't already exist (no OpenAI Reasoning provider, no
  Gemini Vision provider, no Voyage Embeddings provider, etc.)
- Change which vendor actually runs today for any capability
- Wire the registry into any live call site — `11_Benchmark_Engine/modules/analysis/index.js`,
  `11_Benchmark_Engine/modules/reports/homepageReport.js`, and
  `10_Dashboard/lib/benchmarkService.js` still call the concrete OpenAI/Claude code
  directly, unchanged. Flipping those over to `ProviderRegistry` is a follow-up sprint.

## Capabilities

| Capability | Interface | Default provider (this sprint) | Wraps |
|---|---|---|---|
| Navigation | `capabilities/navigation/NavigationProvider.js` | `PlaywrightNavigationProvider` | `11_Benchmark_Engine/modules/{antibot,discovery,vision,navigation_runner}` |
| Vision | `capabilities/vision/VisionProvider.js` | `OpenAIVisionProvider` | `11_Benchmark_Engine/modules/analysis/{promptBuilder,visionModelClient,responseParser}.js` |
| Reasoning | `capabilities/reasoning/ReasoningProvider.js` | `ClaudeReasoningProvider` | `10_Dashboard/lib/providers/ClaudeProvider.js` |
| Reports | `capabilities/reports/ReportProvider.js` | _none yet_ | nothing to wrap — `homepageReport.js`'s Markdown rendering is deterministic templating, not AI-vendor-backed |
| Embeddings | `capabilities/embeddings/EmbeddingsProvider.js` | _none yet_ | nothing — no embeddings use anywhere in the platform today |

**Important:** "Claude remains the default provider" applies to **Reasoning only**.
Vision's default today is OpenAI (GPT-5), because that's what's actually running in
production — see `capabilities/vision/README.md`.

## Usage (once wired into a call site, in a follow-up sprint)

```js
import { getVisionProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';

const findings = await getVisionProvider().analyze({ screenshotPath, discoveryReport });
```

Which concrete class each capability resolves to is controlled entirely by
`config/providers.config.js` — the single file a future Settings UI would edit.
