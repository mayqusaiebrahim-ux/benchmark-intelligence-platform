# Analysis — Vision UX Analysis prototype

**This is a first slice of `modules/analysis/`, not the whole thing.** The
folder's eventual full job (per `11_Benchmark_Engine/README.md`) is scoring —
journey scores, innovation dimensions, AI maturity, the 5 mandatory questions.
None of that is built yet. What's here is narrower and comes first: given one
homepage screenshot and one Discovery Report, produce a structured but
**unscored** qualitative UX read. No numbers, no comparison, no benchmark
verdict — see `contracts/vision_ux_analysis.schema.json`.

## Data flow

```
screenshotPath, discoveryReport
        │
        ▼
promptBuilder.js         → encodes the screenshot as a data URI, summarizes
  buildVisionAnalysisPrompt   discoveryReport as grounding context, assembles
                              { system, messages } for a multimodal model call
        │
        ▼
visionModelClient.js     → NOT IMPLEMENTED. Throws on purpose. This is the
  callVisionModel             one piece Sprint 6 deliberately leaves stubbed;
                              a later sprint wires a real GPT-5 Vision call here.
        │
        ▼
responseParser.js        → validates the model's raw JSON against the
  parseVisionAnalysisResponse required Findings shape, fails loudly on
                              anything malformed or incomplete
        │
        ▼
index.js                 → orchestrates the three steps above, stamps
  analyzeHomepageUX            metadata (model, timestamp), returns the
                              VisionUXAnalysisOutput shape
```

Everything up to the model call is real, runnable code. `callVisionModel` is
the only stub — calling `analyzeHomepageUX()` today will run the full pipeline
and then throw at that one step, which is the intended, visible boundary of
this prototype.

## Explicit non-goals (this slice)

- No scoring, no 1–5 dimensions, no `overall` score.
- No comparison against any other company or prior run.
- No benchmark verdict, no innovation classification.
- No actual API call yet.
