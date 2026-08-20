#!/usr/bin/env node
/**
 * CLI entry point for Sprint 13's parallel benchmark engine.
 * Usage:
 *   node run-parallel-benchmark.js [--concurrency=3] [--companies=path/to/list.json]
 *
 * With no --companies flag, runs the next 6 airlines queued in the project's
 * own airline-only Homepage Benchmark Plan (see
 * 02_Benchmark_Repository/_Homepage_Benchmarks/saudia/homepage_benchmark_plan.md)
 * that haven't been captured yet — Emirates and Qatar Airways are already done.
 */

import { readFileSync } from 'fs';
import { BenchmarkScheduler } from './scheduler/BenchmarkScheduler.js';
import { EVENTS } from './scheduler/progressEvents.js';

const DEFAULT_COMPANIES = [
  { companyName: 'Etihad Airways', companySlug: 'etihad_airways', url: 'https://www.etihad.com/en-ae/' },
  { companyName: 'Turkish Airlines', companySlug: 'turkish_airlines', url: 'https://www.turkishairlines.com/en-int/' },
  { companyName: 'Singapore Airlines', companySlug: 'singapore_airlines', url: 'https://www.singaporeair.com/' },
  { companyName: 'Lufthansa', companySlug: 'lufthansa', url: 'https://www.lufthansa.com/' },
  { companyName: 'Air France', companySlug: 'air_france', url: 'https://wwws.airfrance.us/' },
  { companyName: 'Delta Air Lines', companySlug: 'delta_air_lines', url: 'https://www.delta.com/' },
];

function parseArgs(argv) {
  const args = { concurrency: 3, companiesPath: null };
  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'concurrency') args.concurrency = Number(value);
    if (key === 'companies') args.companiesPath = value;
  }
  return args;
}

function loadCompanies(companiesPath) {
  if (!companiesPath) return DEFAULT_COMPANIES;
  const raw = readFileSync(companiesPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${companiesPath} must contain a non-empty JSON array of { url, companyName?, companySlug? }`);
  }
  return parsed;
}

function fmtElapsed(state) {
  if (!state.startedAt) return '—';
  const end = state.finishedAt ? new Date(state.finishedAt) : new Date();
  const ms = end - new Date(state.startedAt);
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const { concurrency, companiesPath } = parseArgs(process.argv);
  const companies = loadCompanies(companiesPath);

  console.log(`\nParallel Benchmark Engine — Sprint 13 demonstration`);
  console.log(`Companies queued: ${companies.length}`);
  console.log(`Concurrency:      ${concurrency} workers\n`);

  const scheduler = new BenchmarkScheduler({ companies, concurrency });
  const batchStartedAt = Date.now();

  scheduler.on(EVENTS.WORKER_SPAWNED, ({ workerId, pid }) => console.log(`  [worker ${workerId}] spawned (pid ${pid})`));
  scheduler.on(EVENTS.STARTED, (s) => console.log(`  [${s.job.companyName}] attempt ${s.attempts} started (worker pid ${s.workerPid})`));
  scheduler.on(EVENTS.PROGRESS, (s) => console.log(`  [${s.job.companyName}] -> ${s.stage}`));
  scheduler.on(EVENTS.RETRY, (s) => console.log(`  [${s.job.companyName}] attempt ${s.attempts} FAILED (${s.error}) — retrying in ${s.nextAttemptInMs}ms`));
  scheduler.on(EVENTS.SUCCEEDED, (s) => console.log(`  [${s.job.companyName}] ✅ succeeded in ${fmtElapsed(s)} — ${s.result.mdPath}`));
  scheduler.on(EVENTS.FAILED, (s) => console.log(`  [${s.job.companyName}] ❌ failed permanently after ${s.attempts} attempt(s): ${s.error}`));
  scheduler.on(EVENTS.WORKER_EXITED, ({ workerId, code, signal }) => {
    if (code !== 0) console.log(`  [worker ${workerId}] exited unexpectedly (code=${code}, signal=${signal}) — replacing it`);
  });

  const finalStates = await scheduler.run();
  const totalElapsed = ((Date.now() - batchStartedAt) / 1000).toFixed(1);

  console.log(`\n─── Batch complete in ${totalElapsed}s (run ${scheduler.runId}) ───\n`);
  console.log('Company'.padEnd(22), 'Status'.padEnd(12), 'Attempts'.padEnd(10), 'Duration'.padEnd(10), 'Report');
  console.log('-'.repeat(100));
  for (const s of finalStates) {
    const status = s.status === 'succeeded' ? '✅ succeeded' : '❌ failed';
    console.log(
      String(s.job.companyName).padEnd(22),
      status.padEnd(12),
      String(s.attempts).padEnd(10),
      fmtElapsed(s).padEnd(10),
      s.status === 'succeeded' ? s.result.mdPath : s.error,
    );
  }

  const succeeded = finalStates.filter((s) => s.status === 'succeeded').length;
  console.log(`\n${succeeded}/${finalStates.length} companies benchmarked successfully.\n`);

  process.exit(finalStates.some((s) => s.status === 'failed') ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running the parallel benchmark demo:', err);
  process.exit(1);
});
