# Contracts — how modules would communicate

**Status: design only.** These four JSON Schema files define the input/output shape of
each pipeline stage. Nothing reads or validates against them yet — no code in this
repository imports this folder. They exist so `orchestrator/` and `modules/*` can be
built independently, by different people or sessions, against an agreed shape instead
of guessing each other's data.

## The pipeline

Each schema file defines exactly two things: what a module needs to start
(`input`), and what it hands to the next module when it's done (`output`). Read in
order, they describe one straight line:

```
VisionInput  ──▶  [ modules/vision   ]  ──▶  VisionOutput
                                                   │
                                                   ▼
AnalysisInput ◀── (wraps VisionOutput)
                   [ modules/analysis ]  ──▶  AnalysisOutput
                                                   │
                                                   ▼
PatternInput  ◀── (wraps AnalysisOutput)
                   [ pattern extraction ] ─▶  PatternOutput
                                                   │
                                                   ▼
ReportInput   ◀── (wraps Vision + Analysis + Pattern output)
                   [ modules/reports  ]  ──▶  ReportOutput
                                                   │
                                                   ▼
                                     matrix_patch (proposed, not applied)
```

Each stage's `*Input` schema embeds the previous stage's `*Output` schema by
`$ref` (e.g. `analysis.schema.json`'s input references
`vision.schema.json#/$defs/VisionOutput` directly) rather than redefining an
overlapping shape. A module cannot drift from what actually produced its input,
because it isn't allowed to define its own copy of that shape.

`pattern.schema.json` is kept separate from `analysis.schema.json` even though
`11_Benchmark_Engine/README.md` currently describes pattern extraction as living
inside `modules/analysis/`. That's intentional: Reports and a future Dashboard sync
both need pattern findings independently of the full analysis payload, so the contract
is factored out now rather than split apart later once something depends on the
combined shape.

## Design rules these files follow

- **Grounded in what already exists.** Every enum, field name, and object shape
  mirrors data the Dashboard already reads today: `Master_Benchmark_Matrix.json`'s
  `schema` block (journey steps, innovation dimensions, AI capabilities, UX patterns),
  the per-company `metadata.json` shape (`capture_method`, `completion_status`,
  `executive_recommendation`), and the vocabulary already defined in
  `10_Dashboard/lib/requestsStore.js` (`BENCHMARK_TYPES`, `SCOPE_OPTIONS`). A future
  `modules/reports/` implementation should be able to write files the existing
  Dashboard can read with zero changes on the Dashboard side.
- **`schema_version` is a required field on every input and output**, pinned with
  `"const": "0.1.0"` for now. Bump it when a shape changes; a receiving module can
  reject an input whose version it doesn't recognize instead of failing confusingly
  deep inside itself.
- **Every object sets `"additionalProperties": false`.** A module that sends an
  undocumented field should fail loudly at the boundary, not silently pass extra data
  downstream.
- **Required vs. optional is deliberate, not default.** A field is only required when
  every module producing that output must supply it (e.g. `ai_maturity_level` on
  every `AnalysisOutput`). Fields that only apply to some runs — `voice_input_observed`,
  `expected_12_24m`, `executive_recommendation` — are optional.
- **Nothing here writes to `Master_Benchmark_Matrix.json`.** `report.schema.json`'s
  output includes a `matrix_patch` — a *proposed* diff, matching CLAUDE.md's hard rule
  that the matrix JSON is updated first and by a human before `generate_matrix.js`
  runs. No schema in this folder models an "apply" step.

## Explicit non-goals for this sprint

- No AI calls, no OpenAI, no LLM of any kind.
- No Playwright or browser automation.
- No validator wired up (no `ajv`, no dependency added) — these are hand-written,
  hand-checked-valid JSON Schema documents, nothing more.
- No connection to `10_Dashboard/`, `Benchmark_Requests.json`, or
  `Master_Benchmark_Matrix.json`. Field names were chosen to *match* those files so a
  future implementation is cheap, not to read from or write to them now.
