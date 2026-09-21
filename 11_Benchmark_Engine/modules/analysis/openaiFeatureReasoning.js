/**
 * openaiFeatureReasoning — OpenAI implementation of the Feature Benchmark
 * reasoning call. Sibling to FeatureReasoningProvider.js's Anthropic
 * implementation (10_Dashboard/lib/providers/FeatureReasoningProvider.js),
 * same output contract: `{ status: 'completed', data } | { status: 'failed', error }`
 * validated against the same FEATURE_REPORT_SCHEMA, so
 * featureReasoningStage.js needs no change to use either.
 *
 * Lives HERE (not 10_Dashboard/) so the `openai` package resolves via
 * 11_Benchmark_Engine/node_modules — the same reason visionModelClient.js
 * (which already makes a real OpenAI call in this pipeline) lives here too.
 * `openai` is already a declared dependency of this package; nothing new
 * was added.
 */
import OpenAI from 'openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FEATURE_REPORT_SCHEMA, FEATURE_REPORT_EVIDENCE_SOURCES } from '../../../12_Provider_Layer/capabilities/reasoning/featureReportSchema.js';
import { logInfo, logError } from '../../../shared/logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.OPENAI_REASONING_MODEL || 'gpt-5';

try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env')); // 11_Benchmark_Engine/.env
} catch {
  // No .env file present — fall back to whatever is already in process.env.
}

/**
 * @param {object} args
 * @param {string} args.augmentedPrompt  the FULLY built prompt (context +
 *   evidence-discipline instructions + original prompt) — prompt
 *   construction stays single-sourced in FeatureReasoningProvider.js so both
 *   providers see identical instructions.
 */
export async function runOpenAIFeatureReasoning({ augmentedPrompt }) {
  if (!process.env.OPENAI_API_KEY) {
    return { status: 'failed', error: 'OPENAI_API_KEY is not set. Add it to 11_Benchmark_Engine/.env or the environment.' };
  }

  const startedAt = Date.now();
  logInfo('OpenAI reasoning request starting', { model: MODEL });
  try {
    const client = new OpenAI();
    const response = await client.responses.create({
      model: MODEL,
      input: augmentedPrompt,
      text: { format: { type: 'json_schema', name: 'feature_report', schema: FEATURE_REPORT_SCHEMA, strict: true } },
    });
    logInfo('OpenAI reasoning request finished', { durationMs: Date.now() - startedAt });

    const raw = response.output_text;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      logError('Feature Reasoning (OpenAI): response was not valid JSON', err);
      return { status: 'failed', error: `Reasoning output could not be parsed as JSON: ${err.message}` };
    }

    const errors = [];
    if (typeof data.analyzed_company !== 'string' || !data.analyzed_company.trim()) errors.push('analyzed_company must be a non-empty string');
    if (typeof data.feature_found !== 'boolean') errors.push('feature_found must be a boolean');
    if (!FEATURE_REPORT_EVIDENCE_SOURCES.includes(data.evidence_source)) errors.push(`evidence_source invalid: ${data.evidence_source}`);
    if (typeof data.summary_markdown !== 'string' || !data.summary_markdown.trim()) errors.push('summary_markdown must be a non-empty string');
    if (typeof data.evidence_limitations !== 'string' || !data.evidence_limitations.trim()) errors.push('evidence_limitations must be a non-empty string');
    if (errors.length) {
      const errMsg = `Feature Reasoning output failed schema validation: ${errors.join('; ')}`;
      logError('Feature Reasoning (OpenAI): schema validation failed', { error: errMsg });
      return { status: 'failed', error: errMsg };
    }

    return { status: 'completed', data };
  } catch (err) {
    logError('OpenAI reasoning request threw', err, { durationMs: Date.now() - startedAt });
    return { status: 'failed', error: err.message };
  }
}
