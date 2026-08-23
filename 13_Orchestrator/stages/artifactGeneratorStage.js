/**
 * artifactGeneratorStage — Sprint V2.3 / ADR 0001 §5 + ADR 0002.
 *
 * Owns exactly one responsibility: turn Reasoning's structured JSON output
 * (the ADR 0002 contract) into the benchmark's file artifacts on disk, and
 * return a manifest of what was written. It does not call an LLM, does not
 * update Master_Benchmark_Matrix.json (that is Matrix Update — not yet
 * implemented), and does not judge completeness (that stays
 * outputVerificationStage's job).
 *
 * Contract: input is `previousOutput.raw` — a JSON string matching ADR
 * 0002's schema. Output is `{...previousOutput, reasoningData, artifacts}`,
 * where `reasoningData` is the parsed object (so a future Matrix Update
 * stage doesn't have to re-parse `raw` itself) and `artifacts` is the
 * manifest this stage's own docstring on the exported Stage promises.
 *
 * previousOutput is ONE HOP ONLY. BenchmarkRuntime.run() (13_Orchestrator/
 * runtime/Runtime.js) reassigns `lastOutput` to each stage's own return
 * value after every stage, and reasoningStage returns only
 * `{status, raw}` — it does not spread forward what IT received. So by the
 * time this stage runs, navigationStage/screenshotStage/visionStage's
 * output (URL, screenshot paths, Vision findings) is not directly
 * reachable here. That is not a gap this stage needs to work around:
 * reasoningStage already folds that context into the prompt it sends to
 * Reasoning (see buildAugmentedPrompt() in reasoningStage.js), so if a
 * screenshot path needs to appear in a journey step's file, the model
 * echoes it into that step's own `screenshot_refs` field in its JSON
 * response — this stage only ever reads from the parsed `raw` object.
 *
 * NOT wired into fullPipeline.js yet. Reasoning (ClaudeProvider.js) still
 * returns free-form text, unchanged this sprint — inserting this stage
 * into the live pipeline today would make every Full Benchmark throw here
 * instead of reaching Output Verification, with no way to succeed until
 * Reasoning is separately upgraded to request `output_config.format`
 * against the ADR 0002 schema. That upgrade is explicitly out of scope
 * for this sprint ("Do not modify the Reasoning Provider"). See the
 * sprint report for what's left before a real run reaches Completed.
 *
 * Known content-richness gaps vs. the pre-ADR-0002 historical sample files
 * (02_Benchmark_Repository/*, 08_Figma/*), left as schema gaps for a future
 * ADR 0002 amendment rather than silently invented here:
 *   - metadata.json: no `benchmark_id`, `platform`, `capture` (states/
 *     screenshot count), `five_questions` (as 5 discrete fields — the ADR
 *     0002 schema only carries them bundled inside `executive_summary`
 *     prose), or `executive_recommendation`. None of these have a source
 *     field in ADR 0002, so they are omitted rather than fabricated.
 *   - 08_Figma/[Company]/annotations.json: ADR 0002's `figma_annotations`
 *     is four string arrays (journey_map/innovation_callouts/pattern_cards/
 *     opportunity_notes). The real historical file format is a richer
 *     array of objects (id, step, type, title, screenshot, annotation,
 *     industry_position, saudia_relevance, saudia_action per entry). This
 *     stage writes exactly what ADR 0002 defines — deviating from the
 *     accepted schema was not this sprint's call to make.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Stage } from '../runtime/Stage.js';

const CATEGORIES = ['Airlines', 'OTAs', 'AI_First_Products', 'Super_Apps', 'Big_Tech'];

const AI_MATURITY_LEVELS = ['Absent', 'Basic', 'Assistive', 'Conversational', 'Autonomous'];

const EVIDENCE_SOURCES = [
  'OBSERVED', 'RESEARCHED-WEB', 'RESEARCHED-REVIEW', 'RESEARCHED-VIDEO',
  'INFERRED', 'LOGIN-GATED', 'APP-ONLY', 'NOT FOUND',
];

const INDUSTRY_POSITIONS = ['Table Stakes', 'Emerging Trend', 'Unique Differentiator', 'Experimental', 'Ahead of Its Time'];

// step_name (ADR 0002 enum) -> filename stem. Verified against real
// existing files on disk (02_Benchmark_Repository/*/*/02_user_journey/),
// not invented — "Check-in" -> "checkin" (no hyphen), "AI Interaction" ->
// "ai_interaction", etc. match the actual convention already in use.
const JOURNEY_STEPS = [
  { number: 1, name: 'Entry', stem: '01_entry' },
  { number: 2, name: 'Discovery', stem: '02_discovery' },
  { number: 3, name: 'Search', stem: '03_search' },
  { number: 4, name: 'AI Interaction', stem: '04_ai_interaction' },
  { number: 5, name: 'Recommendations', stem: '05_recommendations' },
  { number: 6, name: 'Maps', stem: '06_maps' },
  { number: 7, name: 'Booking', stem: '07_booking' },
  { number: 8, name: 'Ancillaries', stem: '08_ancillaries' },
  { number: 9, name: 'Payment', stem: '09_payment' },
  { number: 10, name: 'Trip Management', stem: '10_trip_management' },
  { number: 11, name: 'Check-in', stem: '11_checkin' },
  { number: 12, name: 'Loyalty', stem: '12_loyalty' },
];

const JOURNEY_STEP_NAMES = JOURNEY_STEPS.map((s) => s.name);

/**
 * Structural validation against the ADR 0002 schema — required fields,
 * types, and enum membership for the fields later code depends on. Not a
 * generic JSON Schema engine: this schema is fixed and known, so explicit
 * checks (matching outputVerificationStage.js's own hand-checked style)
 * are more legible than a general-purpose validator would be here, and add
 * no new dependency to a package (13_Orchestrator) that currently has none.
 */
function validateReasoningOutput(data) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  check(data !== null && typeof data === 'object' && !Array.isArray(data), 'root value must be a JSON object');
  if (!data || typeof data !== 'object') return errors;

  check(data.meta && typeof data.meta === 'object', 'meta is missing');
  if (data.meta) {
    check(typeof data.meta.company_name === 'string' && data.meta.company_name.trim().length > 0, 'meta.company_name is missing or empty');
    check(typeof data.meta.company_slug === 'string' && data.meta.company_slug.trim().length > 0, 'meta.company_slug is missing or empty');
    check(CATEGORIES.includes(data.meta.category), `meta.category must be one of: ${CATEGORIES.join(', ')}`);
    check(typeof data.meta.url === 'string', 'meta.url must be a string (may be empty)');
    check(typeof data.meta.benchmark_date === 'string' && data.meta.benchmark_date.trim().length > 0, 'meta.benchmark_date is missing or empty');
  }

  check(typeof data.executive_summary === 'string' && data.executive_summary.trim().length > 0, 'executive_summary is missing or empty');

  check(Array.isArray(data.journey_steps) && data.journey_steps.length === 12, 'journey_steps must be an array of exactly 12 entries');
  if (Array.isArray(data.journey_steps)) {
    data.journey_steps.forEach((step, i) => {
      if (!step || typeof step !== 'object') {
        errors.push(`journey_steps[${i}] is not an object`);
        return;
      }
      check(JOURNEY_STEP_NAMES.includes(step.step_name), `journey_steps[${i}].step_name "${step.step_name}" is not a recognized step name`);
      check(typeof step.ai_involved === 'boolean', `journey_steps[${i}].ai_involved must be a boolean`);
      check(EVIDENCE_SOURCES.includes(step.evidence_source), `journey_steps[${i}].evidence_source "${step.evidence_source}" is not a recognized value`);
      check(typeof step.narrative_markdown === 'string' && step.narrative_markdown.trim().length > 0, `journey_steps[${i}].narrative_markdown is missing or empty`);
    });
  }

  check(typeof data.ux_analysis === 'string' && data.ux_analysis.trim().length > 0, 'ux_analysis is missing or empty');

  check(data.innovation_scores && typeof data.innovation_scores === 'object', 'innovation_scores is missing');
  if (data.innovation_scores) {
    check(typeof data.innovation_scores.overall_score === 'number', 'innovation_scores.overall_score must be a number');
    check(AI_MATURITY_LEVELS.includes(data.innovation_scores.ai_maturity_level), 'innovation_scores.ai_maturity_level is not a recognized value');
    check(typeof data.innovation_scores.innovation_count === 'number', 'innovation_scores.innovation_count must be a number');
    check(Array.isArray(data.innovation_scores.step_scores), 'innovation_scores.step_scores must be an array');
  }

  check(Array.isArray(data.emerging_patterns), 'emerging_patterns must be an array');
  if (Array.isArray(data.emerging_patterns)) {
    data.emerging_patterns.forEach((p, i) => {
      if (!p || typeof p !== 'object') {
        errors.push(`emerging_patterns[${i}] is not an object`);
        return;
      }
      check(typeof p.pattern_name === 'string' && p.pattern_name.trim().length > 0, `emerging_patterns[${i}].pattern_name is missing or empty`);
      check(INDUSTRY_POSITIONS.includes(p.industry_position), `emerging_patterns[${i}].industry_position is not a recognized value`);
    });
  }

  check(data.innovation_opportunities && typeof data.innovation_opportunities === 'object', 'innovation_opportunities is missing');
  if (data.innovation_opportunities) {
    check(Array.isArray(data.innovation_opportunities.adopt), 'innovation_opportunities.adopt must be an array');
    check(Array.isArray(data.innovation_opportunities.evolve), 'innovation_opportunities.evolve must be an array');
    check(Array.isArray(data.innovation_opportunities.avoid), 'innovation_opportunities.avoid must be an array');
    check(data.innovation_opportunities.saudia_brief_tiers && typeof data.innovation_opportunities.saudia_brief_tiers === 'object', 'innovation_opportunities.saudia_brief_tiers is missing');
  }

  check(typeof data.saudia_opportunities_markdown === 'string' && data.saudia_opportunities_markdown.trim().length > 0, 'saudia_opportunities_markdown is missing or empty');

  check(data.figma_annotations && typeof data.figma_annotations === 'object', 'figma_annotations is missing');

  check(data.matrix_updates && typeof data.matrix_updates === 'object', 'matrix_updates is missing (needed by the future Matrix Update stage, not by this one — validated here so a malformed response fails fast instead of surfacing two stages downstream)');

  return errors;
}

function renderEmergingPatternsMarkdown(data) {
  const lines = [`# Emerging UX Patterns — ${data.meta.company_name}`, '', `**Date:** ${data.meta.benchmark_date}`, '', '---', ''];
  for (const p of data.emerging_patterns) {
    lines.push(`## ${p.pattern_name}`, '');
    lines.push(`**Industry Position:** ${p.industry_position}`);
    if (p.expected_position_12_24mo) lines.push(`**Expected in 12–24mo:** ${p.expected_position_12_24mo}`);
    if (p.saudia_relevance != null) lines.push(`**Saudia Relevance:** ${p.saudia_relevance} / 5`);
    if (p.product_type_fit) lines.push(`**Product Type Fit:** ${p.product_type_fit}`);
    if (p.saudia_timeline) lines.push(`**Saudia Timeline:** ${p.saudia_timeline}`);
    lines.push('', p.description_markdown || '', '');
  }
  return lines.join('\n');
}

function renderInnovationOpportunitiesMarkdown(data) {
  const io = data.innovation_opportunities;
  const list = (items) => (items && items.length ? items.map((i) => `- ${i}`).join('\n') : '_None identified._');
  return [
    `# Innovation Opportunities — ${data.meta.company_name}`,
    '',
    `**Date:** ${data.meta.benchmark_date}`,
    '',
    '---',
    '',
    '## Ideas Worth Adopting', '', list(io.adopt), '',
    '## Ideas Worth Evolving', '', list(io.evolve), '',
    '## Ideas to Avoid', '', list(io.avoid), '',
    '## Saudia Opportunity Brief (Summary)', '',
    '### Quick Wins (0–3 months)', '', list(io.saudia_brief_tiers.quick_wins), '',
    '### Medium-term (3–12 months)', '', list(io.saudia_brief_tiers.medium_term), '',
    '### Long-term Vision (1–3 years)', '', list(io.saudia_brief_tiers.long_term_vision), '',
    '### Moonshot Ideas (3–5 years)', '', list(io.saudia_brief_tiers.moonshot_ideas), '',
    '_Full strategic brief: `07_Saudia_Opportunities/' + `${data.meta.company_name}_opportunities.md` + '`_',
  ].join('\n');
}

/**
 * 00_report.md has no dedicated schema field in ADR 0002 — it is a
 * synthesis of everything else. This stage assembles it mechanically from
 * the other structured fields rather than requiring Reasoning to author a
 * 12th, fully-redundant "full report" string. Flagged here as an explicit
 * implementation choice, not a silent gap-fill.
 */
function buildFullReportMarkdown(data) {
  const s = data.innovation_scores;
  return [
    `# Benchmark Report — ${data.meta.company_name}`,
    '',
    `**Category:** ${data.meta.category}`,
    `**Date:** ${data.meta.benchmark_date}`,
    `**URL:** ${data.meta.url || '_not applicable_'}`,
    `**Overall Score:** ${s.overall_score} / 5.0`,
    `**AI Maturity:** ${s.ai_maturity_level}`,
    '',
    '---',
    '',
    '## Company Overview', '', data.matrix_updates.overview || '', '',
    '## Executive Summary', '', '_See `01_executive_summary.md` for the full summary._', '',
    '## UX Analysis', '', data.ux_analysis, '',
    '## Emerging Patterns', '', '_See `04_emerging_patterns.md` for full detail._', '',
    '## Innovation Opportunities', '', '_See `05_innovation_opportunities.md` for full detail._', '',
    '## Saudia Opportunity Brief', '', `_See \`07_Saudia_Opportunities/${data.meta.company_name}_opportunities.md\`._`, '',
  ].join('\n');
}

/**
 * Mechanically derived, not copied from the richer pre-ADR-0002 historical
 * metadata.json samples — every field here traces to something ADR 0002
 * actually supplies. `deliverables` flags are computed from real presence/
 * absence signals (e.g. figma false when every annotation array is empty),
 * matching how the historical samples themselves vary run to run — not
 * hardcoded true, which the samples on disk prove would sometimes be wrong.
 */
function buildMetadata(data) {
  const s = data.innovation_scores;
  const byStep = {};
  for (const step of s.step_scores || []) {
    const stepDef = JOURNEY_STEPS.find((j) => j.number === step.step_number);
    if (!stepDef) continue;
    const average = (step.clarity + step.ai_sophistication + step.personalization + step.delight + step.innovation) / 5;
    byStep[stepDef.stem] = {
      clarity: step.clarity,
      ai_sophistication: step.ai_sophistication,
      personalization: step.personalization,
      delight: step.delight,
      innovation: step.innovation,
      average: Math.round(average * 10) / 10,
    };
  }

  const anyScreenshotRefs = (data.journey_steps || []).some((j) => Array.isArray(j.screenshot_refs) && j.screenshot_refs.length > 0);
  const figma = data.figma_annotations || {};
  const hasFigma = ['journey_map', 'innovation_callouts', 'pattern_cards', 'opportunity_notes']
    .some((k) => Array.isArray(figma[k]) && figma[k].length > 0);

  return {
    company: data.meta.company_name,
    category: data.meta.category,
    date_benchmarked: data.meta.benchmark_date,
    url: data.meta.url,
    scores: {
      overall: s.overall_score,
      innovation_count: s.innovation_count,
      ai_maturity_level: s.ai_maturity_level,
      by_step: byStep,
    },
    deliverables: {
      '01_executive_summary': true,
      '02_user_journey': true,
      '03_screenshots': anyScreenshotRefs,
      '04_ux_analysis': true,
      '05_innovation_score': true,
      '06_emerging_patterns': (data.emerging_patterns || []).length > 0,
      '07_ideas_worth_adopting': (data.innovation_opportunities.adopt || []).length > 0,
      '08_ideas_worth_evolving': (data.innovation_opportunities.evolve || []).length > 0,
      '09_ideas_to_avoid': (data.innovation_opportunities.avoid || []).length > 0,
      '10_saudia_opportunities': true,
      '11_figma_annotations': hasFigma,
    },
    patterns_extracted: (data.emerging_patterns || []).map((p) => p.pattern_name),
  };
}

function writeArtifacts(data, cwd) {
  const { company_name: companyName, category } = data.meta;
  const companyDir = join(cwd, '02_Benchmark_Repository', category, companyName);
  const journeyDir = join(companyDir, '02_user_journey');
  mkdirSync(journeyDir, { recursive: true });

  const files = {};

  files.executive_summary = join(companyDir, '01_executive_summary.md');
  writeFileSync(files.executive_summary, data.executive_summary, 'utf8');

  files.ux_analysis = join(companyDir, '03_ux_analysis.md');
  writeFileSync(files.ux_analysis, data.ux_analysis, 'utf8');

  files.emerging_patterns = join(companyDir, '04_emerging_patterns.md');
  writeFileSync(files.emerging_patterns, renderEmergingPatternsMarkdown(data), 'utf8');

  files.innovation_opportunities = join(companyDir, '05_innovation_opportunities.md');
  writeFileSync(files.innovation_opportunities, renderInnovationOpportunitiesMarkdown(data), 'utf8');

  files.full_report = join(companyDir, '00_report.md');
  writeFileSync(files.full_report, buildFullReportMarkdown(data), 'utf8');

  files.metadata = join(companyDir, 'metadata.json');
  writeFileSync(files.metadata, JSON.stringify(buildMetadata(data), null, 2), 'utf8');

  files.journey_steps = [];
  for (const step of data.journey_steps) {
    const stepDef = JOURNEY_STEPS.find((j) => j.name === step.step_name);
    const filePath = join(journeyDir, `${stepDef.stem}.md`);
    writeFileSync(filePath, step.narrative_markdown, 'utf8');
    files.journey_steps.push(filePath);
  }

  const saudiaDir = join(cwd, '07_Saudia_Opportunities');
  mkdirSync(saudiaDir, { recursive: true });
  files.saudia_opportunities = join(saudiaDir, `${companyName}_opportunities.md`);
  writeFileSync(files.saudia_opportunities, data.saudia_opportunities_markdown, 'utf8');

  const figmaDir = join(cwd, '08_Figma', companyName);
  mkdirSync(figmaDir, { recursive: true });
  files.figma_annotations = join(figmaDir, 'annotations.json');
  writeFileSync(
    files.figma_annotations,
    JSON.stringify({ company: companyName, date: data.meta.benchmark_date, ...data.figma_annotations }, null, 2),
    'utf8',
  );

  return {
    company_name: companyName,
    company_slug: data.meta.company_slug,
    category,
    company_dir: companyDir,
    files,
    counts: {
      journey_steps_written: files.journey_steps.length,
      patterns_written: (data.emerging_patterns || []).length,
    },
  };
}

export const artifactGeneratorStage = new Stage(
  'artifact_generator',
  'Artifact Generator',
  async ({ cwd, previousOutput }) => {
    const raw = previousOutput?.raw;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error('Artifact Generator received no reasoning output to parse (previousOutput.raw is missing or empty).');
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Artifact Generator could not parse Reasoning's output as JSON: ${err.message}`);
    }

    const errors = validateReasoningOutput(data);
    if (errors.length > 0) {
      throw new Error(
        `Artifact Generator: Reasoning output failed schema validation against ADR 0002 (${errors.length} issue${errors.length === 1 ? '' : 's'}): ${errors.join('; ')}`,
      );
    }

    if (!existsSync(cwd)) {
      throw new Error(`Artifact Generator: cwd does not exist: ${cwd}`);
    }

    const manifest = writeArtifacts(data, cwd);

    return {
      ...(previousOutput || {}),
      reasoningData: data,
      artifacts: manifest,
    };
  },
);
