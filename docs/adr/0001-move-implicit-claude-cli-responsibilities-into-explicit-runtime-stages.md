# ADR 0001: Move implicit Claude CLI responsibilities into explicit Runtime Stages

**Status:** Proposed
**Date:** 2026-08-20
**Supersedes:** none
**Related:** Sprint 24 (Output Verification Layer), Sprint V2.1 (Replace Claude CLI with Anthropic API)

---

## 1. Problem Statement

Sprint V2.1 replaced `ClaudeProvider`'s CLI-spawn implementation with a direct Anthropic Messages API call, preserving the documented `AgentProvider` contract (`run(job) → {status, raw, error}`) exactly, and touching no other file in Runtime, Orchestrator, Dashboard, or `reasoningStage`. The migration was scoped correctly and implemented correctly.

Full benchmarks no longer reach **Completed**. They now stop at **Verification Failed**, because `outputVerificationStage` (Sprint 24) can no longer find the deliverable files, the updated `Master_Benchmark_Matrix.json`, or the screenshots/Saudia brief/Figma annotations it checks for.

This is not a defect in the new provider. It is the exposure of a pre-existing structural problem: the "Reasoning" capability's contract was never actually "text in, text out." The CLI-based implementation quietly performed responsibilities — file writes, matrix mutation, tool execution, step ordering — that the rest of the architecture assumed lived elsewhere, but that nothing in the codebase had ever actually built. This ADR documents that discovery and the target architecture that resolves it.

---

## 2. Current Architecture

- **Provider Registry** (`12_Provider_Layer/registry/ProviderRegistry.js`) resolves a capability name (`reasoning`, `navigation`, `vision`, `screenshot`, …) to a concrete provider class.
- **`AgentProvider` contract** (`10_Dashboard/lib/providers/AgentProvider.js`): `run({prompt, cwd, jobId}) → Promise<{status: 'completed'|'failed', raw?, error?}>`. Documented as the only seam a Reasoning implementation must satisfy.
- **Runtime/Pipeline/Stage model** (`13_Orchestrator/runtime/`): `BenchmarkRuntime` executes an ordered list of `Stage`s; a `Stage.execute(context)` either resolves with output or throws; the Runtime stops at the first throw.
- **`fullPipeline.js`**: `[navigationStage, screenshotStage, visionStage, reasoningStage, outputVerificationStage]` when a URL is present, or `[reasoningStage, outputVerificationStage]` otherwise.
- **`reasoningStage`**: builds an augmented prompt from `previousOutput` (URL, title, screenshots, Vision findings), calls `getReasoningProvider().run(...)`, and throws if the resolved status is not `'completed'`.
- **`outputVerificationStage`** (Sprint 24): checks structural completeness only — `Master_Benchmark_Matrix.json`/`.md`, `00_report.md` through `05_innovation_opportunities.md`, `metadata.json`, `02_user_journey/`, a screenshots folder, the Saudia opportunities brief, Figma annotations. Resolves normally with a pass/fail verdict either way; only throws on a genuine bug in the check itself.
- **`ClaudeProvider`, pre-Sprint-V2.1**: `spawn('claude', ['-p', ...])` — a full interactive Claude Code CLI session, run with `cwd` set to the project root, `CLAUDE.md` auto-loaded as system context, and access to Playwright MCP, Filesystem MCP, and Figma MCP.
- **`ClaudeProvider`, post-Sprint-V2.1**: a direct Anthropic Messages API call (`client.messages.stream(...)`). Text in, text out. No filesystem access, no tool execution.

---

## 3. Hidden Responsibilities Discovered

The CLI implementation satisfied the `AgentProvider` interface by shape while actually performing five distinct categories of work behind that one call:

| Category | What it did |
|---|---|
| **Text generation** *(correctly belongs in the Provider)* | Applied the 5 mandatory questions, the Innovation Filter, the innovation-scoring rubric, and both classification axes; wrote report prose |
| **File operations** | Wrote `00_report.md` → `05_innovation_opportunities.md`, `metadata.json`, `02_user_journey/*`, `07_Saudia_Opportunities/*`, `08_Figma/*/annotations.json`; read `pattern_library.json` and `Master_Benchmark_Matrix.json` |
| **Tool execution** | Playwright MCP (navigate/screenshot/video), Filesystem MCP, Figma MCP, `node scripts/generate_matrix.js`, WebFetch/WebSearch fallback tiers |
| **Workflow orchestration** | Enforced "matrix JSON → regenerate markdown → write report" ordering; ran the Hybrid Research Mode escalation ladder; gated on the pattern-library dedup check |
| **Other** | Auto-loaded `CLAUDE.md` as project context; persisted a multi-step agentic session; ran under a bypassed permission model |

Only the first category was ever the Reasoning Provider's actual job.

---

## 4. Why Replacing Claude CLI Exposed the Issue

The CLI process satisfied `AgentProvider`'s contract by shape (`run() → {status, raw, error}`) while functioning as a second, undocumented orchestration system running entirely behind that one call. As long as it was in place, this was invisible: deliverables appeared, the matrix updated, verification passed — and nothing in Runtime, Pipeline, or Stage code needed to know why, because none of it happened through code those layers could see or control.

The Sprint V2.1 migration changed nothing about the contract and nothing outside `ClaudeProvider.js`. It only removed the one component that had been silently discharging responsibilities the rest of the architecture never took explicit ownership of. `outputVerificationStage` is doing exactly what it was built to do in Sprint 24: report, honestly, that the deliverables it expects do not exist — because nothing in the current explicit pipeline produces them.

The migration did not break the architecture. It revealed that the architecture already had a gap, previously hidden by an opaque provider filling it.

---

## 5. New Stage Responsibilities

```
Reasoning → Deliverable Writer → Matrix Update → Output Verification
```

### Reasoning (unchanged)
- **Input:** prompt assembled from `previousOutput` (URL, title, screenshots, Vision findings) plus the trigger prompt.
- **Output:** `raw` text (or, pending Phase 1 below, a structured document).
- **Boundary:** no file I/O, no tool execution, no orchestration decisions. This is the only seam a Provider swap happens behind — it stays swappable only if nothing else leaks into it.

### Deliverable Writer *(new — does not exist today)*
- **Input:** Reasoning's output, plus `jobId`/company context and the screenshot paths already produced by `screenshotStage`.
- **Output:** the full deliverable file set on disk — `00_report.md` through `05_innovation_opportunities.md`, `metadata.json`, `02_user_journey/*`, `07_Saudia_Opportunities/[Company]_opportunities.md`, `08_Figma/[Company]/annotations.json` — written to the exact paths CLAUDE.md's folder-routing table specifies. Resolves with a manifest of what it wrote.
- **Boundary:** owns *all* filesystem writes of Reasoning-derived content. Does not decide what the content says — only where and how it lands on disk.

### Matrix Update *(new — does not exist today)*
- **Input:** the Deliverable Writer's manifest plus Reasoning's scores/classifications.
- **Output:** an updated `Master_Benchmark_Matrix.json` (company entry, pattern tracker, saudia_gap, scores_index, key_insights) and a regenerated `Master_Benchmark_Matrix.md` via `scripts/generate_matrix.js`, in that order.
- **Boundary:** the single owner of the system-of-record mutation. No other stage writes to the matrix.

### Output Verification (unchanged in role)
- Same structural checks as today. What changes is what it's checking: the explicit output of Deliverable Writer and Matrix Update, not the undocumented side effects of an opaque CLI process.

---

## 6. Future Provider Independence

**Target invariant:** any Reasoning Provider — the current Anthropic Messages API implementation, a future OpenAI/Gemini provider, a Managed-Agents-backed provider, or a re-introduced CLI-backed provider — can be swapped without affecting whether a benchmark reaches Completed.

This holds once Deliverable Writer and Matrix Update exist as their own stages, because "Completed" no longer depends on the Provider incidentally performing file I/O. Any Provider that returns text through the documented `AgentProvider` contract feeds the same downstream stages, regardless of which vendor or mechanism produced that text. This restores the guarantee `AgentProvider.js` already documents as its own design intent: Runtime, Orchestrator, and Dashboard never need to know or care which concrete Provider sits behind a capability.

---

## 7. Migration Strategy

Phased. No phase here is authorized for implementation by this ADR — it documents the target sequence for future sprints to execute individually.

1. **Define Deliverable Writer's input contract.** Decide whether Reasoning returns one document that Deliverable Writer parses/splits, or a structured object (e.g. via `output_config.format`) keyed by deliverable that Deliverable Writer writes directly with no parsing. This is a separate decision this ADR flags but does not make.
2. **Implement Deliverable Writer** as a new Stage, inserted between `reasoningStage` and `outputVerificationStage` in `fullPipeline.js`.
3. **Implement Matrix Update** as a new Stage, inserted between Deliverable Writer and `outputVerificationStage`.
4. **Re-verify:** confirm a URL-present full benchmark run reaches Completed again with the existing Anthropic Messages API provider, unmodified.
5. **Re-audit screenshot/video ownership:** confirm Deliverable Writer only references `screenshotStage`'s existing output and does not need Reasoning to "know about" capture beyond what's already in `previousOutput`.

**Out of scope:** the homepage pipeline (`jobRunner.runCompanyBenchmarkJob()`) does not go through `reasoningStage` or `outputVerificationStage` and is unaffected by any of this.

---

## 8. Risks

- **New single point of failure.** Deliverable Writer's parsing/mapping logic becomes load-bearing. A failure there shifts Verification's failure mode from "no files" to "malformed files" — potentially harder to diagnose, not easier.
- **Structured-output trade-off.** Constraining Reasoning to a schema (for reliable parsing) may reduce report prose quality/flexibility compared to the free-form markdown the CLI agent wrote directly. This is a real trade-off, not a strictly-better move, and needs explicit evaluation before Phase 1 is decided.
- **This does not restore ad hoc research capability.** The CLI could perform its own live research via the Hybrid Research Mode escalation ladder (WebFetch/WebSearch tiers) independent of `navigationStage`/`screenshotStage`/`visionStage`. Nothing in this ADR's scope replaces that. V2 should not treat this ADR as closing that gap.
- **Figma push has no owner even after this ADR.** Deliverable Writer as scoped writes `08_Figma/[Company]/annotations.json` (a file) but does not push to a live Figma document via Figma MCP. Whether that belongs inside Deliverable Writer or needs its own stage is an open question, not resolved here.
- **New maintenance surface.** Two new Stages are new code, new failure modes, and new tests. This is the explicit cost of buying back Provider independence — not free, and should be budgeted as such.

---

## 9. Decision

We will introduce two new explicit Runtime Stages — **Deliverable Writer** and **Matrix Update** — positioned between `reasoningStage` and `outputVerificationStage` in the Full Benchmark pipeline, to own the file-writing and system-of-record-mutation responsibilities that were previously performed implicitly by the CLI-based Reasoning Provider.

The Reasoning Provider's contract (`AgentProvider.run() → {status, raw, error}`) will remain unchanged: text in, text out, no file I/O, no tool execution, no orchestration logic. Any future Reasoning Provider must be swappable behind that contract alone.

This ADR does not authorize implementation. It establishes the target architecture that Sprint work implementing Deliverable Writer and Matrix Update must build toward, and the boundary that future Reasoning Provider changes must respect.
