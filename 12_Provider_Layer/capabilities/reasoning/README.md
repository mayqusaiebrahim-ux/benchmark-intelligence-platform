# Reasoning capability

The capability that autonomously executes a benchmark's full trigger prompt —
navigate, capture, score, write — end to end, with its own tool access.

**Default provider: `ClaudeReasoningProvider`**, a pure re-export of
`10_Dashboard/lib/providers/ClaudeProvider.js`. No new implementation exists here —
that file already spawns the `claude` CLI headlessly and is the real, in-production
Reasoning provider. This folder just gives it a capability-scoped name so it fits the
same registry as Vision/Navigation/Reports/Embeddings.

`10_Dashboard/lib/benchmarkService.js` still imports `ClaudeProvider` directly and is
untouched by this sprint — `getReasoningProvider()` (see `../../registry/ProviderRegistry.js`)
is not wired into it yet. That wiring, and any future `OpenAIReasoningProvider` /
`GeminiReasoningProvider`, is out of scope for Sprint 15.
