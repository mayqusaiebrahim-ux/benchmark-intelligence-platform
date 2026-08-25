/**
 * shared/logger.mjs — Feature Benchmark runtime instrumentation.
 *
 * Deliberately outside 10_Dashboard/, 11_Benchmark_Engine/,
 * 12_Provider_Layer/, and 13_Orchestrator/: this project's own layering is
 * one-directional (Dashboard -> Orchestrator -> {Provider Layer, Engine},
 * never reversed — see BenchmarkOrchestrator.js). Granular instrumentation
 * needs to live inside Engine-level files (discovery/index.js,
 * navigation_runner/*.js) as well as Orchestrator-level stage files, so a
 * logger living inside 13_Orchestrator would force Engine code to import
 * upward, breaking that direction. This file depends on nothing project-
 * specific — every layer can import it without creating a new inter-layer
 * edge. `.mjs` extension (not `.js`) so it's unambiguously ESM regardless
 * of which package.json's "type" field would otherwise govern a plain
 * `.js` file at this path (the project root's package.json declares none).
 *
 * Zero new dependencies: only Node's built-in AsyncLocalStorage, used to
 * carry {requestId, stage} through the async call chain so every log line
 * can include both without threading them through every function
 * signature in files this sprint was told not to redesign. Writes
 * structured JSON lines to console.log/console.error/console.warn —
 * Render (and any Node host) captures stdout/stderr as its runtime logs,
 * so no transport/library is needed for visibility there.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/**
 * withLogContext — runs `fn` with `context` merged onto whatever log
 * context is already active (nesting-safe: an inner call adding {stage}
 * keeps an outer call's {requestId}). Returns fn's return value/promise
 * unchanged.
 */
export function withLogContext(context, fn) {
  const merged = { ...(als.getStore() || {}), ...context };
  return als.run(merged, fn);
}

export function getLogContext() {
  return als.getStore() || {};
}

function write(level, message, extra) {
  const { requestId = null, stage = null } = getLogContext();
  const entry = {
    ts: new Date().toISOString(),
    level,
    requestId,
    stage,
    message,
  };
  if (extra && typeof extra === 'object') Object.assign(entry, extra);
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logInfo(message, extra) {
  write('info', message, extra);
}

export function logWarn(message, extra) {
  write('warn', message, extra);
}

/**
 * logError — accepts either an Error (captures .message/.stack) or a
 * plain extra-fields object, matching call sites that have a caught
 * Error object directly vs. ones reporting a structured failure.
 */
export function logError(message, errOrExtra, extra) {
  if (errOrExtra instanceof Error) {
    write('error', message, { error: errOrExtra.message, stack: errOrExtra.stack, ...extra });
  } else {
    write('error', message, { ...errOrExtra, ...extra });
  }
}

/**
 * logMemory — process.memoryUsage() (rss, heapUsed, heapTotal, external,
 * arrayBuffers) plus pid/uptime, bundled into one log line. Called before
 * and after every Feature Benchmark stage (see featurePipeline.js) and
 * available for any other checkpoint that wants a process snapshot.
 */
export function logMemory(message, extra) {
  const m = process.memoryUsage();
  logInfo(message, {
    memory: {
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
    },
    pid: process.pid,
    uptimeSec: process.uptime(),
    ...extra,
  });
}
