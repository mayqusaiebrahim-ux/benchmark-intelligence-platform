# Vision capability

Turns a homepage screenshot + Discovery Report into a structured, qualitative UX
read — no scoring, no cross-company comparison (see
`11_Benchmark_Engine/modules/analysis/README.md` for the full scope of that slice).

**Default provider: `OpenAIVisionProvider` — not a Claude Vision provider.**
This is the one capability where the platform's default is *not* Claude: the
production Vision pipeline runs on OpenAI's `gpt-5` via the Responses API today
(`11_Benchmark_Engine/modules/analysis/visionModelClient.js`), and that is what
`OpenAIVisionProvider` wraps unchanged. The "Claude remains the default provider"
requirement from Sprint 15 applies to the **Reasoning** capability
(`../reasoning/README.md`), not Vision — do not "fix" this into a
`ClaudeVisionProvider` default without deliberately deciding to change production
behavior; that's a real vendor swap, not an architecture change.

A `ClaudeVisionProvider` / `GeminiVisionProvider` can be added later as an
additional registered option in `../../registry/ProviderRegistry.js` without
touching this file.
