/**
 * outputVerificationStage — Sprint 24: validates that the "full" benchmark's
 * expected deliverables actually exist and are structurally well-formed,
 * instead of treating a zero exit code from the spawned `claude` CLI
 * (reasoningStage) as proof the benchmark actually completed.
 *
 * Structure and completeness ONLY — never content quality. This stage never
 * reads a report's prose and judges whether the UX analysis is good, or
 * whether a score is justified; it only checks that the files/folders
 * CLAUDE.md's own "11 Deliverables" list and "Master Benchmark Matrix"
 * workflow (Hard Rule 14) require actually exist, parse, and are non-empty.
 *
 * Always the last stage in fullPipeline.js, for BOTH url-present and
 * url-less requests (see that file) — this checks Reasoning's own output,
 * which CLAUDE.md's workflow always requires regardless of whether
 * Navigation/Screenshot/Vision ran to enrich Reasoning's prompt.
 *
 * Design — resolves normally, does not throw, when the checked deliverables
 * are incomplete. That is this stage's own correct, successful verdict,
 * exactly like visionStage resolving normally regardless of whether the
 * page looked good — "the deliverables are incomplete" is a finding this
 * stage exists to report, not a crash. It only throws for a genuine
 * execution problem in the check itself (none currently identified; every
 * failure mode below is caught and turned into a verification_errors entry
 * instead). See BenchmarkOrchestrator.js's Sprint 24 addition (forwards
 * err.stageId for the cases that DO throw) and benchmarkService.js's Sprint
 * 24 addition (reads verification_status to choose the Dashboard stage).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { Stage } from '../runtime/Stage.js';

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** True if `dir` exists and contains at least one file, searched recursively
 * (screenshots/journey files are organized into subfolders). */
function hasAnyFile(dir) {
  if (!existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else return true;
    }
  }
  return false;
}

function check(errors, condition, code, message, path) {
  if (!condition) errors.push({ code, message, path: path || null });
}

const REQUIRED_DELIVERABLE_FILES = [
  '00_report.md',
  '01_executive_summary.md',
  '03_ux_analysis.md',
  '04_emerging_patterns.md',
  '05_innovation_opportunities.md',
];

function verifyDeliverables({ cwd, companySlug }) {
  const errors = [];

  const matrixPath = join(cwd, 'Master_Benchmark_Matrix.json');
  const matrixMdPath = join(cwd, 'Master_Benchmark_Matrix.md');
  let matrix = null;

  check(errors, existsSync(matrixPath), 'matrix_missing', 'Master_Benchmark_Matrix.json does not exist.', matrixPath);
  if (existsSync(matrixPath)) {
    try {
      matrix = readJSON(matrixPath);
    } catch {
      check(errors, false, 'matrix_invalid_json', 'Master_Benchmark_Matrix.json exists but is not valid JSON.', matrixPath);
    }
  }

  const companyEntry = matrix?.companies?.[companySlug];
  check(errors, !!companyEntry, 'matrix_company_missing', `Master_Benchmark_Matrix.json has no companies["${companySlug}"] entry.`, matrixPath);

  check(errors, existsSync(matrixMdPath), 'matrix_md_missing', 'Master_Benchmark_Matrix.md does not exist — should be regenerated from the JSON via scripts/generate_matrix.js.', matrixMdPath);
  if (existsSync(matrixMdPath)) {
    const mdStat = statSync(matrixMdPath);
    check(errors, mdStat.size > 0, 'matrix_md_empty', 'Master_Benchmark_Matrix.md exists but is empty.', matrixMdPath);
    if (existsSync(matrixPath)) {
      const jsonStat = statSync(matrixPath);
      check(errors, mdStat.mtimeMs >= jsonStat.mtimeMs, 'matrix_md_stale',
        'Master_Benchmark_Matrix.md is older than Master_Benchmark_Matrix.json — it may not have been regenerated after the JSON was last updated.', matrixMdPath);
    }
  }

  let companyDir = null;
  if (companyEntry?.meta?.report_path) {
    companyDir = join(cwd, dirname(companyEntry.meta.report_path));
    check(errors, existsSync(companyDir), 'company_folder_missing', `Report folder does not exist: ${dirname(companyEntry.meta.report_path)}`, companyDir);
  }

  if (companyDir && existsSync(companyDir)) {
    for (const file of REQUIRED_DELIVERABLE_FILES) {
      const filePath = join(companyDir, file);
      check(errors, existsSync(filePath), 'deliverable_missing', `Missing required deliverable: ${file}`, filePath);
      if (existsSync(filePath)) {
        check(errors, statSync(filePath).size > 0, 'deliverable_empty', `Deliverable exists but is empty: ${file}`, filePath);
      }
    }

    const journeyDir = join(companyDir, '02_user_journey');
    check(errors, hasAnyFile(journeyDir), 'journey_missing', 'No files found in 02_user_journey/.', journeyDir);

    const metadataPath = join(companyDir, 'metadata.json');
    check(errors, existsSync(metadataPath), 'metadata_missing', 'metadata.json does not exist.', metadataPath);
    if (existsSync(metadataPath)) {
      try {
        const metadata = readJSON(metadataPath);
        check(errors, !!metadata.deliverables, 'metadata_incomplete', 'metadata.json exists but has no "deliverables" section.', metadataPath);
        check(errors, !!metadata.scores, 'metadata_incomplete', 'metadata.json exists but has no "scores" section.', metadataPath);
      } catch {
        check(errors, false, 'metadata_invalid_json', 'metadata.json exists but is not valid JSON.', metadataPath);
      }
    }
  }

  const companyName = companyEntry?.meta?.name || null;
  if (companyName) {
    const screenshotsDir = join(cwd, '03_Screenshots', companyName);
    check(errors, hasAnyFile(screenshotsDir), 'screenshots_missing', `No screenshots found under 03_Screenshots/${companyName}/.`, screenshotsDir);

    const saudiaBriefPath = join(cwd, '07_Saudia_Opportunities', `${companyName}_opportunities.md`);
    check(errors, existsSync(saudiaBriefPath), 'saudia_brief_missing', `Saudia opportunities brief missing: 07_Saudia_Opportunities/${companyName}_opportunities.md`, saudiaBriefPath);

    const figmaPath = join(cwd, '08_Figma', companyName, 'annotations.json');
    check(errors, existsSync(figmaPath), 'figma_missing', `Figma annotations missing: 08_Figma/${companyName}/annotations.json`, figmaPath);
  } else if (companyEntry) {
    check(errors, false, 'company_name_unknown', 'Matrix entry has no meta.name — skipped screenshots/Saudia/Figma checks.', null);
  }

  return errors;
}

export const outputVerificationStage = new Stage(
  'output_verification',
  'Output Verification',
  async ({ cwd, jobId, previousOutput }) => {
    const parts = typeof jobId === 'string' ? jobId.split(':') : [];
    const companySlug = parts[1];

    let errors;
    if (!companySlug) {
      errors = [{ code: 'no_company_context', message: 'No company slug could be derived from jobId — nothing to verify against.', path: null }];
    } else {
      errors = verifyDeliverables({ cwd, companySlug });
    }

    const verification_status = errors.length === 0 ? 'passed' : 'failed';
    const verification_summary = verification_status === 'passed'
      ? 'All required deliverables present and structurally valid.'
      : `${errors.length} verification issue${errors.length === 1 ? '' : 's'} found: ${errors.map((e) => e.code).join(', ')}.`;

    return {
      ...(previousOutput || {}),
      verification_status,
      verification_errors: errors,
      verification_summary,
    };
  },
);
