/**
 * progressEvents — the fixed vocabulary BenchmarkOrchestrator emits on
 * itself (an EventEmitter). Deliberately small and separate from
 * 11_Benchmark_Engine/scheduler/progressEvents.js's STAGES enum: that
 * enum doesn't cover every ad hoc stage string jobRunner.js actually
 * produces (e.g. 'antibot_probe:passed:...', 'protected_website'), and
 * the Orchestrator forwards those strings through unmodified rather than
 * normalizing them — see BenchmarkOrchestrator.js.
 */
export const EVENTS = Object.freeze({
  STARTED: 'benchmark:started',
  PROGRESS: 'benchmark:progress',
  SUCCEEDED: 'benchmark:succeeded',
  FAILED: 'benchmark:failed',
});
