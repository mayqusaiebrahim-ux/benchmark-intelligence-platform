/**
 * featureReportWriterStage — writes Reasoning's concise feature report to
 * the Feature Benchmark Library, matching requestsStore.js's storage
 * contract: one markdown file per request, `${requestId}.md`, inside
 * 02_Benchmark_Repository/_Feature_Benchmarks/${slugify(feature)}/.
 *
 * Correctness additions (report belongs to the current request + target):
 *  - logs the five benchmark_target_* fields before writing;
 *  - re-validates the report identifies the target company before writing;
 *  - embeds a machine-readable target marker in the section so the
 *    completion gate (and any auditor) can prove which request / company /
 *    URL / feature this section is for;
 *  - never writes if any of that fails.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Stage } from '../runtime/Stage.js';
import { nameRefersToTarget, targetLogFields } from '../runtime/benchmarkTarget.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

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
  async ({ cwd, target, previousOutput }) => {
    return withLogContext({ stage: 'feature_report_writer' }, async () => {
      if (!target) throw new Error('featureReportWriterStage requires a benchmark target.');
      const data = previousOutput?.reasoningData;
      if (!data) {
        throw new Error('Feature Report Writer received no Reasoning output to write.');
      }

      logInfo('Feature Report Writer starting', targetLogFields(target));

      // Final gate before persisting: the content must be about the target.
      const refCheck = nameRefersToTarget(target, `${data.analyzed_company || ''}\n${data.summary_markdown || ''}`);
      if (!refCheck.ok) {
        throw new Error(
          `Feature Report Writer: report content is not about the target "${target.company}" — ${refCheck.reason}. Not writing.`,
        );
      }
      // Evidence must have belonged to the target too (defence in depth).
      const ev = previousOutput?.evidence;
      if (!ev || ev.company !== target.slug || ev.feature !== target.feature) {
        throw new Error('Feature Report Writer: evidence does not match the target. Not writing.');
      }

      const featureSlug = slugify(target.feature);
      const dir = join(cwd, '02_Benchmark_Repository', '_Feature_Benchmarks', featureSlug);
      const filePath = join(dir, `${target.requestId}.md`);

      try {
        mkdirSync(dir, { recursive: true });

        // Machine-readable, human-invisible (HTML comment) — the completion
        // gate checks for `request=<id>` and `company=<name>` here.
        const marker = `<!-- benchmark-target: company=${target.company} | slug=${target.slug} | url=${target.url} | feature=${target.feature} | request=${target.requestId} -->`;

        const section = [
          `## ${target.company}`,
          '',
          marker,
          '',
          `**Feature:** ${target.feature}`,
          `**Evidence source:** ${data.evidence_source}`,
          `**Feature found:** ${data.feature_found ? 'Yes' : 'No'}`,
          `**Analyzed company:** ${data.analyzed_company}`,
          `**Benchmarked at:** ${new Date().toISOString()}`,
          '',
          data.summary_markdown,
          '',
          '---',
          '',
        ].join('\n');

        const header = `# Feature Benchmark — ${target.feature}\n\n`;
        const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : header;
        writeFileSync(filePath, existing + section, 'utf8');
      } catch (err) {
        logError('Feature Report Writer threw', err);
        throw err;
      }

      logInfo('Feature Report Writer finished', { ...targetLogFields(target), filePath });
      return { ...(previousOutput || {}), reportPath: filePath };
    });
  },
);
