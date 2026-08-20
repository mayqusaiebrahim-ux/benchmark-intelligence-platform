/**
 * ClaudeReasoningProvider — the default Reasoning provider.
 *
 * Deliberately NOT a new class: 10_Dashboard/lib/providers/ClaudeProvider.js
 * already implements exactly this capability (spawns the `claude` CLI
 * headlessly against a trigger prompt) and is a working, in-production
 * seam. Reimplementing or subclassing it here would risk diverging from
 * the real thing for no benefit — this is a pure re-export alias so
 * `12_Provider_Layer` callers can name it by capability while
 * 10_Dashboard/lib/benchmarkService.js keeps its own working, untouched
 * `new ClaudeProvider()` import.
 *
 * `ClaudeProvider` already satisfies `ReasoningProvider`'s contract
 * (`run({ prompt, cwd, jobId })` → `{status, raw?, error?}`) by shape,
 * without needing to literally extend it.
 */
export { ClaudeProvider as ClaudeReasoningProvider } from '../../../10_Dashboard/lib/providers/ClaudeProvider.js';
