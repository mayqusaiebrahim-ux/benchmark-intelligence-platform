/**
 * featureReportWriterStage — Sprint Reset: writes Reasoning's concise
 * feature report to the Feature Benchmark Library, matching the storage
 * contract 10_Dashboard/lib/requestsStore.js already established
 * (feature_benchmark_path / listFeatureBenchmarks()) — one markdown file
 * per request, named `${requestId}.md`, inside
 * 02_Benchmark_Repository/_Feature_Benchmarks/${slugify(feature)}/. This is
 * the exact convention listFeatureBenchmarks() already reads from, so the
 * Dashboard's existing, unmodified Library view picks this up with zero
 * Dashboard changes.
 *
 * A request can have multiple competitor items under one feature — each
 * company's completed run appends its own `## CompanyName` section to the
 * same requestId.md rather than overwriting it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Stage } from '../runtime/Stage.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

// Matches requestsStore.js's own slugify() exactly, so the folder name this
// stage writes to is identical to the one createRequest() already computed
// into feature_benchmark_path when the request was created.
function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const featureReportWriterStage = new Stage(
  'feature_report_writer',
  'Feature Benchmark Report',
  async ({ cwd, requestId, company, feature, previousOutput }) => {
    return withLogContext({ stage: 'feature_report_writer' }, async () => {
      const data = previousOutput?.reasoningData;
      if (!data) {
        const err = new Error('Feature Report Writer received no Reasoning output to write.');
        logError('Feature Report Writer missing input', err);
        throw err;
      }
      if (!requestId) {
        const err = new Error('Feature Report Writer requires a requestId to name the report file.');
        logError('Feature Report Writer missing requestId', err);
        throw err;
      }

      const featureSlug = slugify(feature);
      const dir = join(cwd, '02_Benchmark_Repository', '_Feature_Benchmarks', featureSlug);
      const filePath = join(dir, `${requestId}.md`);
      logInfo('Feature Report Writer starting', { filePath });

      try {
        mkdirSync(dir, { recursive: true });

        const section = [
          `## ${company || 'Unknown company'}`,
          '',
          `**Feature:** ${feature}`,
          `**Evidence source:** ${data.evidence_source}`,
          `**Feature found:** ${data.feature_found ? 'Yes' : 'No'}`,
          `**Benchmarked at:** ${new Date().toISOString()}`,
          '',
          data.summary_markdown,
          '',
          '---',
          '',
        ].join('\n');

        const header = `# Feature Benchmark — ${feature}\n\n`;
        const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : header;
        writeFileSync(filePath, existing + section, 'utf8');
      } catch (err) {
        logError('Feature Report Writer threw', err);
        throw err; // rethrow unchanged
      }

      logInfo('Feature Report Writer finished', { filePath });
      return { ...(previousOutput || {}), reportPath: filePath };
    });
  },
);
