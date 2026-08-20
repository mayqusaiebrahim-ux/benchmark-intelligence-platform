# Embeddings capability

The contract for turning text into vector embeddings.

**No default provider this sprint, and no current use case.** Nothing in the platform
today — Discovery, Vision, Reasoning, Reports, or the Dashboard — embeds text or does
similarity search. This capability is defined now because the target architecture
names it explicitly (pattern-library matching across benchmarks is a plausible future
use), but per "do not implement all providers," no `OpenAIEmbeddingsProvider` /
`VoyageEmbeddingsProvider` / `GeminiEmbeddingsProvider` is added until a real use case
needs one.
