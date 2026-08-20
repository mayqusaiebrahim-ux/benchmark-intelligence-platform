/**
 * BenchmarkRuntime — executes a Pipeline's stages sequentially. Knows
 * nothing about providers, Claude, or any other concrete capability — it
 * only ever calls stage.execute(context) and records status/timing/output/
 * error around that call. This is what "the Runtime should never know
 * which provider is behind a stage" means concretely.
 *
 * On the first stage that throws: stop, mark that stage 'failed', mark
 * every remaining stage 'skipped' (never started), and throw a
 * RuntimeStageError naming which stage failed. pipelines/fullPipeline.js
 * lets that propagate — BenchmarkOrchestrator.js's existing try/catch
 * around pipeline.run() turns it into { status: 'failed', error: {message,
 * stack} }, unchanged.
 */
export class RuntimeStageError extends Error {
  constructor(stageId, cause, stages) {
    super(`Stage "${stageId}" failed: ${cause?.message || cause}`);
    this.name = 'RuntimeStageError';
    this.stageId = stageId;
    this.cause = cause;
    this.stages = stages; // full per-stage record list, for future debugging/UI
  }
}

export class BenchmarkRuntime {
  /**
   * @param {import('./Pipeline.js').Pipeline} pipeline
   * @param {object} context - forwarded to every stage's execute(context)
   * @param {(event: object) => void} [onProgress]
   * @returns {Promise<{stages: object[], output: any}>}
   */
  async run(pipeline, context, onProgress = () => {}) {
    const stages = [];
    let lastOutput;

    for (let i = 0; i < pipeline.stages.length; i++) {
      const stage = pipeline.stages[i];
      const record = {
        id: stage.id, name: stage.name, status: 'running',
        startedAt: new Date().toISOString(), finishedAt: null,
        durationMs: null, output: null, error: null,
      };
      stages.push(record);
      onProgress({ stage: stage.id, status: 'running' });
      const startedAtMs = Date.now();

      try {
        const output = await stage.execute({ ...context, previousOutput: lastOutput });
        record.status = 'completed';
        record.output = output;
        record.finishedAt = new Date().toISOString();
        record.durationMs = Date.now() - startedAtMs;
        lastOutput = output;
        onProgress({ stage: stage.id, status: 'completed' });
      } catch (err) {
        record.status = 'failed';
        record.error = err?.message || String(err);
        record.finishedAt = new Date().toISOString();
        record.durationMs = Date.now() - startedAtMs;

        for (let j = i + 1; j < pipeline.stages.length; j++) {
          const skipped = pipeline.stages[j];
          stages.push({
            id: skipped.id, name: skipped.name, status: 'skipped',
            startedAt: null, finishedAt: null, durationMs: null,
            output: null, error: null,
          });
        }

        onProgress({ stage: stage.id, status: 'failed', error: record.error });
        throw new RuntimeStageError(stage.id, err, stages);
      }
    }

    return { stages, output: lastOutput };
  }
}
