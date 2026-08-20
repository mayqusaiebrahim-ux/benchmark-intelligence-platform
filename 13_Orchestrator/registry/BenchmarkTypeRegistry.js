/**
 * BenchmarkTypeRegistry — resolves a benchmark type name to its pipeline,
 * per config/benchmarkTypes.config.js. Mirrors 12_Provider_Layer/registry/
 * ProviderRegistry.js's shape on purpose: a getter that throws clearly on
 * an unknown name, rather than a bare object lookup scattered across
 * callers.
 */
import { benchmarkTypes } from '../config/benchmarkTypes.config.js';

export function getPipeline(type) {
  const pipeline = benchmarkTypes[type];
  if (!pipeline) {
    throw new Error(`No benchmark type registered for "${type}". Known types: ${Object.keys(benchmarkTypes).join(', ')}.`);
  }
  return pipeline;
}

export function listBenchmarkTypes() {
  return Object.keys(benchmarkTypes);
}
