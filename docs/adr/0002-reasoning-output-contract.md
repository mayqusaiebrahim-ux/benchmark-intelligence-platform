# ADR 0002: Reasoning Output Contract — Free-form Markdown vs. Structured JSON

**Status:** Proposed
**Date:** 2026-08-20
**Related:** ADR 0001 (Move implicit Claude CLI responsibilities into explicit Runtime Stages) — this resolves the open decision left in ADR 0001 §7, Phase 1.

**Naming note:** ADR 0001 called the file-writing stage "Deliverable Writer." This sprint's brief calls the same stage "Artifact Generator." This document uses **Artifact Generator** throughout, as the current name for that stage; it is the same component, not a new one.

---

## 1. Context

ADR 0001 established a three-stage boundary — `Reasoning → Artifact Generator → Matrix Update → Output Verification` — but explicitly left one decision open: what shape does Reasoning's output take when it crosses into Artifact Generator and Matrix Update? This ADR answers that question and, if it recommends structured output, defines the schema itself.

---

## 2. Option A — Free-form Markdown

Reasoning returns one large markdown document (as the CLI-based provider effectively did); Artifact Generator parses headings/sections to extract per-file content, and Matrix Update parses further to extract scores/classifications.

| Dimension | Assessment |
|---|---|
| **Reliability** | Low. Depends on the model's heading/section conventions staying consistent request-to-request. No validation exists at the API boundary — a drifted heading style breaks parsing silently. |
| **Ease of implementation** | High up front (no schema to design, no `output_config.format` wiring), but front-loads the real cost onto a markdown parser that must handle every section-boundary and formatting variant the model might produce. |
| **Maintainability** | Poor. Every prompt tweak, model version, or effort-level change risks silently changing output formatting and breaking the parser. Failures are heuristic pattern mismatches, not compiler-catchable errors. |
| **Validation** | None at the API layer. `output_config.format` is not usable with free-form text. Validation is deferred entirely to post-hoc re-parsing — itself unreliable. |
| **Provider independence** | Weak. Each provider (Anthropic, OpenAI, Gemini, a future Managed-Agents provider) tends toward its own house formatting style unless heavily prompt-constrained, and prompt constraints are requested, not enforced. Swapping providers risks silently changing parser success rate. |
| **Long-term scalability** | Poor. As CLAUDE.md's deliverable and scoring requirements grow, the parser's heading/section taxonomy must grow with it — every new field is a new heuristic, and heuristics compound. |
| **Impact on Output Verification** | No upgrade path. Verification stays limited to existence/non-empty checks (as today) because there is no structured data to validate against — the same limitation Sprint 24 already accepted, but now permanently instead of as an interim step. |
| **Impact on future LLM providers** | Every new provider needs its own prompt-tuning pass to match the shared parser's expectations — recurring, provider-specific integration cost. |
| **Impact on report quality** | The one real strength. Continuous prose lets the model connect sections naturally — the Executive Summary → UX Analysis → Innovation Opportunities progression reads as one argument, not independent fragments. Matches CLAUDE.md's instruction to make "every finding connect to a direction." |

---

## 3. Option B — Structured JSON

Reasoning returns a single JSON object matching a fixed schema (via `output_config.format`); Artifact Generator writes fields directly to their target files with no parsing; Matrix Update reads scores/classifications directly from typed fields.

| Dimension | Assessment |
|---|---|
| **Reliability** | High. `output_config.format` constrains the response to the schema at the API layer — the response *is* valid against the schema by construction, eliminating the "parser guessed wrong" failure class entirely. Residual risk (a field being thin or generic) is a content-quality risk, not a structural one, and applies equally to Option A. |
| **Ease of implementation** | Higher up front (schema design + `output_config.format` wiring), but Artifact Generator's logic becomes close to mechanical field-to-file mapping rather than a parsing problem — lower cost for every change after the first. |
| **Maintainability** | High. The schema itself documents the contract. Schema changes are explicit and additive; drift is caught by the API rejecting non-conforming output, not discovered later as a production data quality issue. |
| **Validation** | Strong. Types, required fields, and enums (classification axes, 1–5 score bands, evidence-source labels) are checkable structurally — something Option A cannot support without reintroducing the same heuristics it's trying to avoid. |
| **Provider independence** | Strong — this is the dimension the sprint goal targets directly. Any provider implementing `AgentProvider.run()` that can return schema-constrained JSON satisfies the same contract; provider swaps become a capability question ("does it support structured output"), not a formatting-compatibility question. |
| **Long-term scalability** | Strong. New CLAUDE.md requirements become new schema fields — additive and versionable — rather than new parser heuristics. The schema can be composed/split as requirements grow. |
| **Impact on Output Verification** | Genuine upgrade, not just preservation. Verification can move from "does the file exist and is it non-empty" toward "does the underlying data conform to the schema" — catchable at the Reasoning→Artifact-Generator boundary, before any (possibly broken) file is written. Sprint 24's own principle — structure and completeness only, never content quality — is honored more precisely, since structural completeness becomes a first-class, schema-checkable property. |
| **Impact on future LLM providers** | Lower per-provider integration cost — "return JSON matching this schema" is a broadly supported capability across major providers, not an Anthropic-specific one. The schema itself becomes the acceptance test for plugging in a new provider. |
| **Impact on report quality** | The real cost, mirroring Option A's strength in reverse. Decomposing narrative content into independent fields risks flattening cross-section connective tissue. **Mitigated, not eliminated**, by keeping prose-heavy fields (executive summary, UX analysis, patterns, opportunities) as single large markdown-string values within the schema — structured at the field level, free-form within each field. |

---

## 4. Recommendation

**Structured JSON (Option B).**

The sprint's stated goal — "make the Reasoning Provider completely provider-independent" — requires a machine-checkable contract at the API boundary. A shared assumption about markdown formatting conventions is not a contract; it is an informal convention that has already proven fragile once (the CLI migration). Option B's report-quality risk is real but bounded: the schema below keeps every narrative section as a single free-text markdown string, so the model still writes connected prose within each field — it is only the *boundaries between* deliverables that become structured, not the writing itself.

---

## 5. The Schema

This is the `output_config.format` JSON Schema that becomes the contract for every future Reasoning Provider. It is written to the constraints Anthropic's structured outputs actually support: no `minimum`/`maximum`/`minLength` (unsupported), no recursive schemas — score dimensions use integer enums instead of numeric ranges, and every object sets `"additionalProperties": false` with an explicit `"required"` list.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "meta",
    "executive_summary",
    "journey_steps",
    "ux_analysis",
    "innovation_scores",
    "emerging_patterns",
    "innovation_opportunities",
    "saudia_opportunities_markdown",
    "figma_annotations",
    "matrix_updates"
  ],
  "properties": {
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["company_name", "company_slug", "category", "url", "benchmark_date"],
      "properties": {
        "company_name": { "type": "string", "description": "Display name, e.g. 'Mindtrip'" },
        "company_slug": { "type": "string", "description": "Filesystem-safe key matching Master_Benchmark_Matrix.json's companies[] key" },
        "category": { "type": "string", "enum": ["Airlines", "OTAs", "AI_First_Products", "Super_Apps", "Big_Tech"] },
        "url": { "type": "string", "description": "Primary URL benchmarked, or empty string for a feature-only/URL-less request" },
        "benchmark_date": { "type": "string", "description": "ISO 8601 date this benchmark was run" }
      }
    },

    "executive_summary": {
      "type": "string",
      "description": "Full markdown content for 01_executive_summary.md. One page, answers the 5 mandatory questions at the product level."
    },

    "journey_steps": {
      "type": "array",
      "description": "Exactly 12 entries, one per CLAUDE.md journey step, in step order.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["step_number", "step_name", "ai_involved", "evidence_source", "narrative_markdown"],
        "properties": {
          "step_number": { "type": "integer", "enum": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
          "step_name": {
            "type": "string",
            "enum": [
              "Entry", "Discovery", "Search", "AI Interaction", "Recommendations",
              "Maps", "Booking", "Ancillaries", "Payment", "Trip Management",
              "Check-in", "Loyalty"
            ]
          },
          "ai_involved": { "type": "boolean", "description": "False → this step gets a one-paragraph note only, per the Innovation Filter" },
          "evidence_source": {
            "type": "string",
            "enum": [
              "OBSERVED", "RESEARCHED-WEB", "RESEARCHED-REVIEW", "RESEARCHED-VIDEO",
              "INFERRED", "LOGIN-GATED", "APP-ONLY", "NOT FOUND"
            ]
          },
          "narrative_markdown": {
            "type": "string",
            "description": "Full markdown content for this step's file in 02_user_journey/. One paragraph if ai_involved is false."
          },
          "screenshot_refs": {
            "type": "array",
            "description": "Paths (already written by screenshotStage) this step's narrative references, for Artifact Generator to cross-link — not new writes.",
            "items": { "type": "string" }
          }
        }
      }
    },

    "ux_analysis": {
      "type": "string",
      "description": "Full markdown content for 03_ux_analysis.md — design quality, AI maturity, interaction patterns."
    },

    "innovation_scores": {
      "type": "object",
      "additionalProperties": false,
      "required": ["overall_score", "step_scores", "innovation_count", "ai_maturity_level"],
      "properties": {
        "overall_score": { "type": "number", "description": "Mean of all step scores" },
        "ai_maturity_level": {
          "type": "string",
          "enum": ["Absent", "Basic", "Assistive", "Conversational", "Autonomous"]
        },
        "innovation_count": { "type": "integer", "description": "Number of steps scoring 4+ on the Innovation dimension" },
        "step_scores": {
          "type": "array",
          "description": "One entry per journey step scored (ai_involved steps only need full scoring).",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["step_number", "clarity", "ai_sophistication", "personalization", "delight", "innovation"],
            "properties": {
              "step_number": { "type": "integer", "enum": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
              "clarity": { "type": "integer", "enum": [1, 2, 3, 4, 5] },
              "ai_sophistication": { "type": "integer", "enum": [1, 2, 3, 4, 5] },
              "personalization": { "type": "integer", "enum": [1, 2, 3, 4, 5] },
              "delight": { "type": "integer", "enum": [1, 2, 3, 4, 5] },
              "innovation": { "type": "integer", "enum": [1, 2, 3, 4, 5] }
            }
          }
        }
      }
    },

    "emerging_patterns": {
      "type": "array",
      "description": "Full content for 04_emerging_patterns.md, and the source list Matrix Update reconciles against pattern_library.json.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["pattern_name", "description_markdown", "saudia_relevance", "industry_position", "expected_position_12_24mo"],
        "properties": {
          "pattern_name": { "type": "string" },
          "description_markdown": { "type": "string" },
          "saudia_relevance": { "type": "integer", "enum": [1, 2, 3, 4, 5] },
          "industry_position": {
            "type": "string",
            "enum": ["Table Stakes", "Emerging Trend", "Unique Differentiator", "Experimental", "Ahead of Its Time"]
          },
          "expected_position_12_24mo": {
            "type": "string",
            "enum": ["Table Stakes", "Emerging Trend", "Unique Differentiator", "Experimental", "Ahead of Its Time"]
          },
          "product_type_fit": {
            "type": "string",
            "enum": ["Airline-Native", "OTA-Adjacent", "Platform-Level", "AI-Native Only"]
          },
          "saudia_timeline": {
            "type": "string",
            "enum": ["Now (0-6 months)", "Short-term (6-18 months)", "Medium-term (18-36 months)", "Long-term (3-5 years)", "Not for Saudia"]
          }
        }
      }
    },

    "innovation_opportunities": {
      "type": "object",
      "additionalProperties": false,
      "required": ["adopt", "evolve", "avoid", "saudia_brief_tiers"],
      "description": "Full content for 05_innovation_opportunities.md",
      "properties": {
        "adopt": { "type": "array", "items": { "type": "string" }, "description": "Ideas Worth Adopting — as-is or minimal adaptation" },
        "evolve": { "type": "array", "items": { "type": "string" }, "description": "Ideas Worth Evolving — good but could go further with Saudia's context" },
        "avoid": { "type": "array", "items": { "type": "string" }, "description": "Ideas to Avoid — friction, confusion, or brand mismatch, with reason" },
        "saudia_brief_tiers": {
          "type": "object",
          "additionalProperties": false,
          "required": ["quick_wins", "medium_term", "long_term_vision", "moonshot_ideas"],
          "properties": {
            "quick_wins": { "type": "array", "items": { "type": "string" } },
            "medium_term": { "type": "array", "items": { "type": "string" } },
            "long_term_vision": { "type": "array", "items": { "type": "string" } },
            "moonshot_ideas": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    },

    "saudia_opportunities_markdown": {
      "type": "string",
      "description": "Full markdown content for 07_Saudia_Opportunities/[Company]_opportunities.md — the synthesized strategic brief, built from innovation_opportunities.saudia_brief_tiers."
    },

    "figma_annotations": {
      "type": "object",
      "additionalProperties": false,
      "required": ["journey_map", "innovation_callouts", "pattern_cards", "opportunity_notes"],
      "description": "Full content for 08_Figma/[Company]/annotations.json",
      "properties": {
        "journey_map": { "type": "array", "items": { "type": "string" } },
        "innovation_callouts": { "type": "array", "items": { "type": "string" } },
        "pattern_cards": { "type": "array", "items": { "type": "string" } },
        "opportunity_notes": { "type": "array", "items": { "type": "string" } }
      }
    },

    "matrix_updates": {
      "type": "object",
      "additionalProperties": false,
      "required": ["overview", "ai_capabilities", "ux_patterns", "pattern_tracker_entries", "key_insight", "beats_best_in_class"],
      "description": "Everything Matrix Update needs to write Master_Benchmark_Matrix.json's companies[company_slug] entry and related top-level sections. company meta comes from the top-level `meta` object; journey_scores/innovation_scores come from `innovation_scores` above.",
      "properties": {
        "overview": { "type": "string", "description": "Short company/product overview for the matrix entry" },
        "ai_capabilities": { "type": "array", "items": { "type": "string" }, "description": "Notable AI capabilities, for the matrix companies[].ai_capabilities list" },
        "ux_patterns": { "type": "array", "items": { "type": "string" }, "description": "Pattern names present, for the matrix companies[].ux_patterns list" },
        "pattern_tracker_entries": {
          "type": "array",
          "description": "One entry per pattern in emerging_patterns, telling Matrix Update how to reconcile against pattern_library.json.",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["pattern_name", "is_new_to_library"],
            "properties": {
              "pattern_name": { "type": "string" },
              "is_new_to_library": { "type": "boolean", "description": "True if this pattern was not already in pattern_library.json before this benchmark" }
            }
          }
        },
        "key_insight": {
          "type": "object",
          "additionalProperties": false,
          "required": ["synthesis", "saudia_imperative", "watch_for_questions"],
          "description": "The new entry for Master_Benchmark_Matrix.json's key_insights array",
          "properties": {
            "synthesis": { "type": "string" },
            "saudia_imperative": { "type": "string" },
            "watch_for_questions": { "type": "array", "items": { "type": "string" } }
          }
        },
        "beats_best_in_class": {
          "type": "boolean",
          "description": "True if this benchmark's overall_score beats the matrix's current saudia_gap.best_score — tells Matrix Update whether to update best_in_class/best_score"
        }
      }
    }
  }
}
```

---

## 6. Consumer Mapping

| Schema section | Consumed by |
|---|---|
| `meta` | Artifact Generator (file paths, company folder), Matrix Update (`companies[slug].meta`), Output Verification (resolves `companySlug` — same role `jobId` parsing plays today) |
| `executive_summary` | Artifact Generator → `01_executive_summary.md` |
| `journey_steps[]` | Artifact Generator → `02_user_journey/*` (one file per step) |
| `ux_analysis` | Artifact Generator → `03_ux_analysis.md` |
| `innovation_scores` | Artifact Generator → `metadata.json.scores`; Matrix Update → `companies[slug].journey_scores` / `innovation_scores` |
| `emerging_patterns[]` | Artifact Generator → `04_emerging_patterns.md`; Matrix Update → pattern reconciliation via `matrix_updates.pattern_tracker_entries` |
| `innovation_opportunities` | Artifact Generator → `05_innovation_opportunities.md` |
| `saudia_opportunities_markdown` | Artifact Generator → `07_Saudia_Opportunities/[Company]_opportunities.md` |
| `figma_annotations` | Artifact Generator → `08_Figma/[Company]/annotations.json` |
| `matrix_updates` | Matrix Update → `companies[slug]` remaining fields, `pattern_tracker`, `key_insights`, `saudia_gap` |
| Whole document | Output Verification — schema conformance is checkable directly against this document, before Artifact Generator writes anything, in addition to the existing post-write file checks |

Every field required by CLAUDE.md's 11 deliverables and the Master Benchmark Matrix workflow traces to exactly one schema section above — nothing is produced by inference or left for Artifact Generator/Matrix Update to derive from prose.

---

## 7. Decision

We will adopt **Structured JSON** as the Reasoning output contract. The schema in §5 becomes the `output_config.format` every future Reasoning Provider must satisfy. Free-form markdown (Option A) is rejected as the contract shape, though nothing here prevents individual fields (e.g. `executive_summary`, `ux_analysis`) from containing markdown-formatted prose internally.

This ADR does not authorize implementation. It resolves the open decision from ADR 0001 §7, Phase 1; wiring `output_config.format` into the Reasoning Provider and building Artifact Generator/Matrix Update against this schema remain separate, future implementation sprints.
