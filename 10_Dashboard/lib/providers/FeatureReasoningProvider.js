/**
 * FeatureReasoningProvider — Sprint Reset: the Reasoning call for the
 * Feature Benchmark pipeline only. A direct Anthropic Messages API call,
 * same conventions as ClaudeProvider.js (env loading, streaming,
 * output_config.format), but against FEATURE_REPORT_SCHEMA instead of the
 * empirically-too-large REASONING_OUTPUT_SCHEMA. Deliberately a separate
 * file rather than a parameter on ClaudeProvider.js — ClaudeProvider.js is
 * the 'full' pipeline's Reasoning Provider and is not touched by this
 * sprint.
 *
 * Lives in 10_Dashboard/ (not 13_Orchestrator/) purely so `@anthropic-ai/sdk`
 * resolves via 10_Dashboard/node_modules, the same reason
 * ClaudeReasoningProvider.js already re-exports ClaudeProvider from here
 * instead of reimplementing it in 12_Provider_Layer.
 */
import Anthropic from '@anthropic-ai/sdk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FEATURE_REPORT_SCHEMA, FEATURE_REPORT_EVIDENCE_SOURCES } from '../../../12_Provider_Layer/capabilities/reasoning/featureReportSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = 'claude-opus-5';
const MAX_TOKENS = 4000; // one concise report, not an 11-deliverable document

try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env')); // 10_Dashboard/.env
} catch {
  // No .env file present — fall back to whatever is already in process.env.
}

function buildPrompt({ prompt, company, feature, previousOutput }) {
  const { url, title, visionFindings, featureStepId, featureStepFound, selectedStep } = previousOutput || {};
  const lines = ['## Feature Benchmark Context', ''];
  lines.push(`Company: ${company || '(unknown)'}`);
  lines.push(`Requested feature: ${feature}`);
  lines.push(`Mapped CLAUDE.md journey step: ${featureStepId || '(no journey step matched this feature keyword)'}`);
  lines.push(`Target step actually reached by the crawler: ${featureStepFound ? 'yes' : 'no — the page below is the closest fallback the crawler could reach'}`);
  if (selectedStep) lines.push(`Page examined: "${selectedStep.title}" (navigation status: ${selectedStep.status})`);
  if (url) lines.push(`URL: ${url}`);
  if (title) lines.push(`Page title: ${title}`);
  if (visionFindings) {
    lines.push('', 'Structural findings from Vision (detection only, not judgment or opinion):', '```json', JSON.stringify(visionFindings, null, 2), '```');
  }
  lines.push('', 'Write ONE concise benchmark report for this feature only. If the target step was not reached, say so honestly and set feature_found to false and evidence_source to an appropriate value (e.g. NOT FOUND) — do not invent content for a feature that was not actually observed.');
  lines.push('', '---', '');
  return `${lines.join('\n')}${prompt}`;
}

export async function runFeatureReasoning({ prompt, company, feature, previousOutput }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 'failed', error: 'ANTHROPIC_API_KEY is not set. Add it to 10_Dashboard/.env or the environment.' };
  }

  try {
    const augmentedPrompt = buildPrompt({ prompt, company, feature, previousOutput });
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: augmentedPrompt }],
      output_config: { format: { type: 'json_schema', schema: FEATURE_REPORT_SCHEMA } },
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return { status: 'failed', error: `Claude refused the request${message.stop_details?.category ? ` (category: ${message.stop_details.category})` : ''}.` };
    }
    if (message.stop_reason === 'max_tokens') {
      return { status: 'failed', error: `Response was truncated at max_tokens (${MAX_TOKENS}) before the JSON output completed.` };
    }

    const raw = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return { status: 'failed', error: `Reasoning output could not be parsed as JSON: ${err.message}` };
    }

    const errors = [];
    if (typeof data.feature_found !== 'boolean') errors.push('feature_found must be a boolean');
    if (!FEATURE_REPORT_EVIDENCE_SOURCES.includes(data.evidence_source)) errors.push(`evidence_source invalid: ${data.evidence_source}`);
    if (typeof data.summary_markdown !== 'string' || !data.summary_markdown.trim()) errors.push('summary_markdown must be a non-empty string');
    if (errors.length) {
      return { status: 'failed', error: `Feature Reasoning output failed schema validation: ${errors.join('; ')}` };
    }

    return { status: 'completed', data };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}
