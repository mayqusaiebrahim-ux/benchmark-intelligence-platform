# ADR 0003: Decompose the Reasoning Contract into Independent Structured Reasoning Stages

**Status:** Proposed
**Date:** 2026-08-23
**Supersedes:** none — amends the *delivery mechanism* of ADR 0002 §5 only. ADR 0002's actual decision (structured JSON over free-form markdown) is not reopened.
**Related:** ADR 0001 (Move implicit Claude CLI responsibilities into explicit Runtime Stages), ADR 0002 (Reasoning Output Contract), Verification Sprint (2026-08-23) — the run that discovered this problem.

---

## 1. Problem Statement

The Verification Sprint executed ADR 0002's contract for real, for the first time, against the live Anthropic API: `ClaudeProvider.run()` with `output_config.format` set to the full `REASONING_OUTPUT_SCHEMA`. The call was rejected before any model turn happened:

```
400 { "type": "invalid_request_error",
      "message": "The compiled grammar is too large, which would cause
                   performance issues. Simplify your tool schemas or
                   reduce the number of strict tools." }
```

Reproduced twice, identical request, two different `request_id`s — deterministic, not transient.

This is a **packaging** failure, not a content failure. ADR 0002 §3's case for structured JSON — reliability, schema-checkable validation, provider independence, scalability — is not invalidated by this error; the schema was simply never deployable as one request. Nothing in ADR 0002 was implemented before this was discovered (per ADR 0002 §7, it explicitly deferred implementation), so no downstream stage — Artifact Generator, Matrix Update, Output Verification — has ever depended on the single-call shape. There is nothing to migrate away from, only a delivery mechanism to redesign before anything is built.

**Explicit non-goals, per this sprint's brief:**
- Not shrinking the schema's actual field-level requirements — every deliverable, every scoring dimension, every classification axis from ADR 0002 §5 is preserved.
- Not reopening ADR 0002 §2–4 — free-form markdown remains rejected as the contract shape.
- Not authorizing implementation. Same posture as ADR 0001 §9 and ADR 0002 §7.

---

## 2. Why the Grammar Is Too Large

Anthropic's strict structured outputs (`output_config.format`) compile a JSON Schema into a constrained-decoding grammar before the model runs. Grammar size scales with schema complexity — nesting depth, number of distinct enum branches, and array-of-object cardinality all compound *multiplicatively*, not additively, because the compiler must represent every legal path through the structure.

`REASONING_OUTPUT_SCHEMA` asks for all of the following in one compiled grammar:

| Structure | Cost driver |
|---|---|
| `journey_steps[12]` | 12 fixed array slots × (12-value enum + 8-value enum + object shape) |
| `innovation_scores.step_scores[]` | up to 12 array slots × 5 separate 1–5 integer enums each = up to 60 enum-constrained leaves |
| `emerging_patterns[]` | unbounded array × up to 4 enums per item (5-, 5-, 4-, 5-value) |
| `innovation_opportunities.saudia_brief_tiers` | 4 nested string arrays |
| `matrix_updates` | nested object with its own required array of objects (`pattern_tracker_entries`) and nested object (`key_insight`) |
| 10 required top-level sections | each independently `additionalProperties:false` with its own `required` list |

No single one of these is unusual. All of them compiled into **one** grammar, simultaneously, is what exceeded Anthropic's ceiling. The fix is architectural: no single request should ask the grammar compiler to represent this much branching at once.

---

## 3. Design Principle

Two principles govern the split, both extensions of decisions already made in ADR 0001 and ADR 0002:

1. **Split by content boundary, not by arbitrary size-cutting.** Each new stage corresponds to one coherent piece of analysis a person would recognize as its own task (journey documentation, scoring, pattern-spotting, opportunity synthesis, executive summary, Figma/matrix synthesis) — matching how CLAUDE.md itself already separates these as distinct deliverables and, in the case of the Executive Summary, an explicitly *ordered* one (Hard Rule #4: "Write the Executive Summary last — it synthesizes everything"). This ADR turns that prose rule into an architectural dependency instead of a hoped-for prompt instruction.
2. **Apply ADR 0001's own filter recursively: only put in a Reasoning stage what actually requires reasoning.** ADR 0001 drew this line between the Provider and the rest of the pipeline; this ADR draws it again *inside* Reasoning itself. Three fields in ADR 0002 §5 are pure arithmetic or data comparison over values the model already produced or that already exist on disk — `innovation_scores.overall_score`, `innovation_scores.innovation_count`, and `matrix_updates.beats_best_in_class`. Asking the model to self-report these is both unnecessary API-grammar weight and a latent correctness risk (a self-reported mean can simply be arithmetically wrong, and `beats_best_in_class` was being asked of a model that ADR 0002 never actually gave the current best score to compare against). This ADR moves all three to mechanical computation in a new, non-LLM composition step.

---

## 4. New Architecture Overview

`reasoningStage` (ADR 0001 §5) is no longer one API call. It becomes a **Reasoning Pipeline** of six independent structured-output calls plus one mechanical composition step. From `fullPipeline.js`'s perspective, nothing changes — the Reasoning Pipeline still returns exactly the `{status: 'completed', raw}` shape `reasoningStage` returns today, and `raw` still deserializes to exactly the ADR 0002 §5 document. Artifact Generator, Matrix Update, and Output Verification require **zero changes**.

```
Trigger prompt + Capture Context (URL, screenshots, Vision findings — unchanged from ADR 0001 §5's Reasoning boundary)
        │
        ▼
 [1] Journey Reasoning
        │
        ├───────────────┬────────────────┐
        ▼                ▼                │
 [2] Scoring       [3] Patterns           │   (2 and 3 each depend only on 1 —
        │                │                │    independently callable/parallelizable)
        └───────┬────────┘                │
                ▼                         │
      [4] Opportunities  ◄────────────────┘
                │
                ▼
      [5] Executive Summary
                │
                ▼
      [6] Figma & Matrix Synthesis
                │
                ▼
      [Composer] Reasoning Composer  (mechanical — no LLM call)
                │
                ▼
   { status: 'completed', raw: <JSON — byte-for-byte the ADR 0002 §5 shape> }
                │
                ▼
   Artifact Generator → Matrix Update → Output Verification     (UNCHANGED — ADR 0001 §5, ADR 0002)
```

**External, non-reasoning inputs** (read by the pipeline layer, not generated by any stage — same category of input `screenshotStage`'s output already is to `reasoningStage` today):
- `06_AI_Trends/pattern_library.json` → injected into Stage 3's prompt, so the model can judge novelty against the real library instead of guessing.
- `Master_Benchmark_Matrix.json`'s `saudia_gap.best_score` → read by the Composer, not any LLM stage, to compute `beats_best_in_class` mechanically.

---

## 5. Stage Definitions

### Stage 1 — Journey Reasoning

- **Purpose:** Document the 12 CLAUDE.md journey steps — apply the Innovation Filter (`ai_involved`), label evidence source, write each step's narrative — and establish the benchmark's identity (`meta`). This is the observational foundation every later stage reasons over.
- **Input:** Trigger prompt + the existing capture-context augmentation (`buildAugmentedPrompt` logic from today's `reasoningStage.js` — URL, title, screenshots, Vision findings). This is the *only* stage that touches raw capture context; every later stage receives Stage 1's own written output instead, preserving ADR 0001's principle that capture context has exactly one consumer.
- **Output JSON:**
  ```json
  {
    "type": "object", "additionalProperties": false,
    "required": ["meta", "journey_steps"],
    "properties": {
      "meta": { "...identical to ADR 0002 §5 meta..." },
      "journey_steps": { "...identical to ADR 0002 §5 journey_steps, including screenshot_refs..." }
    }
  }
  ```
- **Consumer:** Composer (assembles into final document, unchanged); Stages 2–6 (read Stage 1's `journey_steps`/`meta` as their own prompt context, not as schema input).
- **Dependencies:** none (first stage).

### Stage 2 — UX & Scoring Reasoning

- **Purpose:** Design-quality/AI-maturity analysis (`03_ux_analysis.md`) and the 5-dimension innovation scoring rubric per step. Grounded in Stage 1's narratives so scores are justified by the same text a reader sees, not independently re-derived.
- **Input:** Trigger prompt/company context + Stage 1's full output (`meta`, `journey_steps`).
- **Output JSON:**
  ```json
  {
    "type": "object", "additionalProperties": false,
    "required": ["ux_analysis", "ai_maturity_level", "step_scores"],
    "properties": {
      "ux_analysis": { "type": "string" },
      "ai_maturity_level": { "type": "string", "enum": ["Absent", "Basic", "Assistive", "Conversational", "Autonomous"] },
      "step_scores": { "...identical item shape to ADR 0002 §5 innovation_scores.step_scores..." }
    }
  }
  ```
  `overall_score` and `innovation_count` are **not** requested here — see §7.
- **Consumer:** Composer.
- **Dependencies:** Stage 1.

### Stage 3 — Pattern Reasoning

- **Purpose:** Identify emerging UX patterns and classify each on both Strategic Classification axes (Industry Position, Saudia Feasibility), and judge novelty against the real pattern library.
- **Input:** Trigger prompt/company context + Stage 1's `journey_steps` + **external input:** current `06_AI_Trends/pattern_library.json` contents (so novelty judgment is grounded in the real library, not guessed — a correctness improvement over ADR 0002, which never gave the model this file at all despite asking a downstream stage to reconcile against it).
- **Output JSON:**
  ```json
  {
    "type": "object", "additionalProperties": false,
    "required": ["emerging_patterns"],
    "properties": {
      "emerging_patterns": {
        "type": "array",
        "items": {
          "type": "object", "additionalProperties": false,
          "required": ["pattern_name", "description_markdown", "saudia_relevance", "industry_position", "expected_position_12_24mo", "is_new_to_library"],
          "properties": {
            "pattern_name": { "type": "string" },
            "description_markdown": { "type": "string" },
            "saudia_relevance": { "type": "integer", "enum": [1, 2, 3, 4, 5] },
            "industry_position": { "type": "string", "enum": ["Table Stakes", "Emerging Trend", "Unique Differentiator", "Experimental", "Ahead of Its Time"] },
            "expected_position_12_24mo": { "type": "string", "enum": ["Table Stakes", "Emerging Trend", "Unique Differentiator", "Experimental", "Ahead of Its Time"] },
            "product_type_fit": { "type": "string", "enum": ["Airline-Native", "OTA-Adjacent", "Platform-Level", "AI-Native Only"] },
            "saudia_timeline": { "type": "string", "enum": ["Now (0-6 months)", "Short-term (6-18 months)", "Medium-term (18-36 months)", "Long-term (3-5 years)", "Not for Saudia"] },
            "is_new_to_library": { "type": "boolean", "description": "True if not already present in pattern_library.json" }
          }
        }
      }
    }
  }
  ```
  `is_new_to_library` moves here from ADR 0002's `matrix_updates.pattern_tracker_entries` — same fact, judged in the one stage that actually has the library content in context, instead of re-derived blind in a later stage.
- **Consumer:** Composer.
- **Dependencies:** Stage 1.

### Stage 4 — Opportunity Reasoning

- **Purpose:** Ideas Worth Adopting/Evolving/Avoiding, and the 4-tier Saudia Opportunity Brief, synthesized from everything observed so far.
- **Input:** Trigger prompt/company context + Stage 1 (journey) + Stage 2 (ux_analysis, scores) + Stage 3 (emerging_patterns).
- **Output JSON:**
  ```json
  {
    "type": "object", "additionalProperties": false,
    "required": ["innovation_opportunities", "saudia_opportunities_markdown"],
    "properties": {
      "innovation_opportunities": { "...identical to ADR 0002 §5 innovation_opportunities..." },
      "saudia_opportunities_markdown": { "type": "string" }
    }
  }
  ```
- **Consumer:** Composer.
- **Dependencies:** Stages 1, 2, 3.

### Stage 5 — Executive Summary Reasoning

- **Purpose:** The one-page, VP-level synthesis answering the 5 mandatory questions at the product level. Its own stage, positioned last among the content stages, operationalizes CLAUDE.md Hard Rule #4 ("Write the Executive Summary last") as a dependency edge instead of a prompt instruction the model could ignore.
- **Input:** Trigger prompt/company context + Stages 1–4 in full (journey, scoring, patterns, opportunities) — deliberately the richest context of any stage, since synthesis is the entire job.
- **Output JSON:**
  ```json
  {
    "type": "object", "additionalProperties": false,
    "required": ["executive_summary"],
    "properties": { "executive_summary": { "type": "string" } }
  }
  ```
- **Consumer:** Composer.
- **Dependencies:** Stages 1, 2, 3, 4.

### Stage 6 — Figma & Matrix Synthesis Reasoning

- **Purpose:** Figma-ready annotation content, and the remaining cross-cutting matrix fields that require holistic judgment (company overview, notable AI capabilities/UX patterns for the matrix, and the new `key_insights` entry).
- **Input:** Trigger prompt/company context + Stages 1–5 in full.
- **Output JSON:**
  ```json
  {
    "type": "object", "additionalProperties": false,
    "required": ["figma_annotations", "matrix_overview", "ai_capabilities", "ux_patterns", "key_insight"],
    "properties": {
      "figma_annotations": { "...identical to ADR 0002 §5 figma_annotations..." },
      "matrix_overview": { "type": "string" },
      "ai_capabilities": { "type": "array", "items": { "type": "string" } },
      "ux_patterns": { "type": "array", "items": { "type": "string" } },
      "key_insight": { "...identical to ADR 0002 §5 matrix_updates.key_insight..." }
    }
  }
  ```
- **Consumer:** Composer.
- **Dependencies:** Stages 1, 2, 3, 4, 5.

### Composer — Reasoning Composer (mechanical, no LLM call)

- **Purpose:** Reassemble Stages 1–6's six JSON fragments, plus three mechanically-derived values, into one document that is structurally identical to ADR 0002 §5 — so every stage downstream of Reasoning is unaware anything changed. This is pure data reshaping (object construction and arithmetic), not parsing of free text — a categorically safer kind of code than the markdown-parsing risk ADR 0001 §8 flagged for Artifact Generator, because every input here already passed its own stage's schema validation before Composer sees it.
- **Input:** The six stage outputs above, plus **external input:** `Master_Benchmark_Matrix.json`'s `saudia_gap.best_score`.
- **Output:** `{ status: 'completed', raw: <JSON string> }` — the `raw` string parses to exactly the ADR 0002 §5 shape. Field-by-field construction:

  | ADR 0002 §5 field | Source |
  |---|---|
  | `meta` | Stage 1 |
  | `journey_steps` | Stage 1 |
  | `executive_summary` | Stage 5 |
  | `ux_analysis` | Stage 2 |
  | `innovation_scores.ai_maturity_level` | Stage 2 |
  | `innovation_scores.step_scores` | Stage 2 |
  | `innovation_scores.overall_score` | **Computed:** mean, across `step_scores`, of each entry's own 5-dimension mean — the exact CLAUDE.md "Innovation Scoring Rubric → Aggregate Scores" formula, now executed in code instead of self-reported |
  | `innovation_scores.innovation_count` | **Computed:** count of `step_scores` entries with `innovation >= 4` |
  | `emerging_patterns` | Stage 3, with `is_new_to_library` stripped from each entry before placement (moved to `matrix_updates.pattern_tracker_entries` instead, below) |
  | `innovation_opportunities` | Stage 4 |
  | `saudia_opportunities_markdown` | Stage 4 |
  | `figma_annotations` | Stage 6 |
  | `matrix_updates.overview` | Stage 6 (`matrix_overview`) |
  | `matrix_updates.ai_capabilities` | Stage 6 |
  | `matrix_updates.ux_patterns` | Stage 6 |
  | `matrix_updates.pattern_tracker_entries` | **Computed:** `{pattern_name, is_new_to_library}` pairs extracted from Stage 3 |
  | `matrix_updates.key_insight` | Stage 6 |
  | `matrix_updates.beats_best_in_class` | **Computed:** `innovation_scores.overall_score > saudia_gap.best_score` (external input) — previously asked of a model that was never given `best_score` to compare against |

- **Consumer:** Artifact Generator (unchanged — same `previousOutput.raw` contract as today).
- **Dependencies:** Stages 1–6, plus the external matrix read.

---

## 6. Execution Order & Parallelism

The dependency graph in §4 requires: `1 → {2, 3} → 4 → 5 → 6 → Composer`. Stages 2 and 3 depend only on Stage 1 and not on each other, so they are safe to execute concurrently once Stage 1 completes — a latency optimization, not a correctness requirement. Running the whole chain strictly sequentially (1→2→3→4→5→6→Composer) is also correct, just slower. Whether the Runtime gains a concurrent-stage-execution capability to exploit this is a separate decision for the implementation sprint, not required by this ADR.

---

## 7. Equivalence Guarantee

Every field in ADR 0002 §5's schema is produced by exactly one of the six stages or computed by the Composer — nothing is dropped, and nothing is invented that ADR 0002 didn't already require:

| ADR 0002 §5 top-level field | Now produced by |
|---|---|
| `meta` | Stage 1 |
| `executive_summary` | Stage 5 |
| `journey_steps` | Stage 1 |
| `ux_analysis` | Stage 2 |
| `innovation_scores` | Stage 2 + Composer arithmetic |
| `emerging_patterns` | Stage 3 |
| `innovation_opportunities` | Stage 4 |
| `saudia_opportunities_markdown` | Stage 4 |
| `figma_annotations` | Stage 6 |
| `matrix_updates` | Stage 3 (patterns) + Stage 6 (overview/capabilities/patterns/key_insight) + Composer (`beats_best_in_class`) |

The Composer's output must continue to pass the exact same `validateReasoningOutput()` checks `artifactGeneratorStage.js` already runs today, unmodified — that function is the acceptance test for this entire ADR, not a new one written for it.

---

## 8. Contract With the Rest of the Pipeline

`fullPipeline.js`'s stage list — `[navigationStage, screenshotStage, visionStage, reasoningStage, outputVerificationStage]` (ADR 0001 §5) — does not change its shape. `reasoningStage` internally becomes a Reasoning Pipeline of seven steps (six calls + Composer) instead of one call, but externally still satisfies the identical contract: given `{prompt, cwd, jobId, previousOutput}`, resolve with `{status: 'completed', raw}` or throw. Artifact Generator, Matrix Update, and Output Verification are unaware anything changed.

This does add one nuance to ADR 0001 §6's "Future Provider Independence" claim, which this ADR does not weaken but does need to state precisely: a future non-Anthropic Reasoning Provider now has a somewhat larger integration surface — it must implement six structured calls and the composition logic (or its own equivalent decomposition) rather than one. In practice this is likely a wash or a net improvement: a single grammar this large was already provider-hostile, since most vendors offering structured/constrained output impose their own complexity ceilings. Six smaller, independently-reasonable schemas are more broadly portable than one that has already been proven too large for the vendor this project actually uses.

---

## 9. Risks

- **Latency.** A sequential chain of up to six model calls (or four, with Stages 2/3 parallelized) is slower end-to-end than one call. Full-pipeline benchmark duration will increase; not quantified here.
- **Token cost.** Each stage restates condensed upstream context in its prompt. Total tokens across six calls will exceed the single 64K-budget call, though each individual call's `max_tokens` need can now be far smaller per stage.
- **Partial-failure surface.** A failure at Stage 4 wastes Stages 1–3's completed work unless the Runtime can retry a single failed stage rather than restarting the whole Reasoning Pipeline. Stage-level retry is a Runtime capability this ADR assumes will exist but does not design.
- **Composer is a new code-only point of failure**, but a strictly safer one than free-text parsing (ADR 0001 §8's original concern for Artifact Generator): every input Composer touches already passed its own stage's structured-output validation before Composer ever sees it. Composer's own job — object reshaping and arithmetic — is fully unit-testable without ever calling an LLM.
- **Cross-stage drift.** Scoring (Stage 2), patterns (Stage 3), and everything downstream reason over Stage 1's *written* journey text, not the raw capture context directly. This is intentional (§5, Stage 1) but means a later stage can only ever be as accurate as Stage 1's narrative — an error in Stage 1 propagates rather than getting an independent second look. Mitigation: always pass the exact upstream stage output text verbatim into later prompts, never a paraphrase or summary of it.
- **Per-stage schema size is still unproven, not just assumed safe.** Isolating `journey_steps` (Stage 1) and `step_scores` (Stage 2) away from the other five structures removes the compounding effect that caused the original failure, but no stage schema above has been run against Anthropic's actual grammar compiler yet. **Before any implementation sprint wires these into `fullPipeline.js`, each stage's schema must be independently verified against the live `output_config.format` endpoint** — exactly the empirical check the original Verification Sprint ran, repeated once per new stage. If any individual stage still fails, the documented fallback is to split it further along the same content-boundary principle (§3) — e.g., Stage 1's 12-step array into two 6-step calls — without requiring a new ADR for that iteration.

---

## 10. Migration Strategy

Phased. As with ADR 0001 §7 and ADR 0002 §7, **no phase here is authorized for implementation by this ADR.**

1. Define the shared "structured reasoning call" primitive (prompt + schema → validated JSON) that all six stages use, so each stage is a thin schema+prompt definition against one common calling mechanism rather than six duplicated provider implementations.
2. Implement and empirically verify Stage 1 in isolation against the live Anthropic structured-output endpoint (per §9's last risk).
3. Implement and verify Stages 2 and 3 (independently — both depend only on Stage 1).
4. Implement and verify Stages 4, 5, 6 in sequence.
5. Implement the Composer; verify its output passes `artifactGeneratorStage.js`'s existing `validateReasoningOutput()` unmodified.
6. Re-run the full Verification Sprint (Reasoning Pipeline → Artifact Generator, real API calls, no mocking) end-to-end, confirming a benchmark can reach a schema-valid document and generated artifacts where the single-call version could not.
7. Only then wire the Reasoning Pipeline into `fullPipeline.js` in place of the current single-call `reasoningStage`, with zero changes required to `artifactGeneratorStage.js`, Matrix Update, or `outputVerificationStage.js`.

---

## 11. Decision

We will decompose the Reasoning contract into six independent structured-output stages (Journey, Scoring, Patterns, Opportunities, Executive Summary, Figma & Matrix Synthesis) plus a mechanical, non-LLM Composer that reassembles their outputs into a document structurally identical to ADR 0002 §5. ADR 0002's decision to use structured JSON, and the schema's actual field-level content, are both preserved in full — this ADR changes only how that document is produced, replacing one oversized `output_config.format` request with several independently-sized ones plus deterministic arithmetic for the three fields (`overall_score`, `innovation_count`, `beats_best_in_class`) that never required a model at all.

This ADR does not authorize implementation. It establishes the target architecture for a future sprint to build toward, and the per-stage empirical verification gate (§9) that must pass before any stage is wired into the live pipeline.
