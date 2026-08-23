/**
 * ClaudeProvider — Sprint V2.1: calls the Anthropic Messages API directly
 * instead of spawning the local `claude` CLI. Authenticates via
 * ANTHROPIC_API_KEY (env var only — no interactive login, no local binary),
 * which is what unblocks unattended execution on a cloud host (Railway or
 * similar) — the exact gap the deployment simulation identified: the old
 * implementation had zero process.env-based auth path and depended on a
 * `claude` binary that a cloud host does not have installed.
 *
 * Auth mirrors the existing OpenAI vision provider's convention
 * (11_Benchmark_Engine/modules/analysis/visionModelClient.js): load
 * 10_Dashboard/.env via Node's built-in process.loadEnvFile() if present,
 * otherwise fall back to whatever is already in process.env (e.g. a
 * platform-injected env var in production). The Anthropic SDK itself also
 * auto-resolves ANTHROPIC_API_KEY from process.env with no arguments
 * needed — the explicit check below exists only to fail fast with a
 * specific, actionable error message instead of a generic SDK auth error.
 *
 * Streaming is used unconditionally (client.messages.stream() +
 * finalMessage()) rather than a plain create() call — this is what
 * "support large prompts" and "support long-running responses" actually
 * requires here: a non-streaming request with a large max_tokens risks
 * client-side and platform-level idle-connection timeouts, since no bytes
 * flow until the full response is ready. Streaming sends bytes
 * continuously, sidestepping that risk, while finalMessage() still hands
 * back one accumulated response — so the run() contract below stays a
 * single await, unchanged from the caller's perspective.
 *
 * Sprint V2.4 — ADR 0002 structured output: the request now carries
 * `output_config.format` set to REASONING_OUTPUT_SCHEMA
 * (12_Provider_Layer/capabilities/reasoning/reasoningOutputSchema.js), the
 * JSON Schema ADR 0002 defines as the Reasoning→Artifact Generator
 * contract. This constrains the API response itself to that schema — the
 * response is valid JSON matching it by construction, not by hope. Nothing
 * else about this file changes: `raw` is still the joined text content of
 * the response, still a plain string; only what that string CONTAINS
 * changes, from free-form markdown to a JSON document. The AgentProvider
 * contract ({status, raw, error}) is untouched, exactly as ADR 0001 §9
 * requires of every Reasoning Provider.
 *
 * This closes the "text only, no file writes" gap described below only
 * partially: Reasoning now returns the structured data Artifact Generator
 * needs, but this file still does not write anything to disk itself —
 * that responsibility correctly stays with Artifact Generator
 * (13_Orchestrator/stages/artifactGeneratorStage.js), which this sprint
 * does not modify.
 */

import Anthropic from '@anthropic-ai/sdk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AgentProvider } from './AgentProvider.js';
import { REASONING_OUTPUT_SCHEMA } from '../../../12_Provider_Layer/capabilities/reasoning/reasoningOutputSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'claude-opus-5';
// Bumped from 32000 (Sprint V2.1) — a schema-shaped response (12 structured
// journey entries, scores, patterns, opportunities, the full Saudia brief,
// Figma annotations) carries more structural/JSON overhead than the
// equivalent free-form report did, and needs commensurately more headroom.
const DEFAULT_MAX_TOKENS = 64000;

try {
  // 10_Dashboard/.env — two levels up from lib/providers/.
  process.loadEnvFile(join(__dirname, '..', '..', '.env'));
} catch {
  // No .env file present — fall back to whatever is already in process.env.
}

export class ClaudeProvider extends AgentProvider {
  async run({ prompt, cwd, jobId }) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        status: 'failed',
        error: 'ANTHROPIC_API_KEY is not set. Add it to 10_Dashboard/.env or the environment.',
      };
    }

    try {
      const client = new Anthropic();
      const stream = client.messages.stream({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: REASONING_OUTPUT_SCHEMA } },
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        return {
          status: 'failed',
          error: `Claude refused the request${message.stop_details?.category ? ` (category: ${message.stop_details.category})` : ''}.`,
        };
      }

      // A schema-constrained response that hits max_tokens is truncated
      // mid-JSON — it will not parse. Fail here with a clear cause instead
      // of letting Artifact Generator report an opaque JSON.parse error
      // two stages downstream.
      if (message.stop_reason === 'max_tokens') {
        return {
          status: 'failed',
          error: `Response was truncated at max_tokens (${Number(process.env.ANTHROPIC_MAX_TOKENS) || DEFAULT_MAX_TOKENS}) before the JSON output completed. Increase ANTHROPIC_MAX_TOKENS.`,
        };
      }

      const raw = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return { status: 'completed', raw };
    } catch (err) {
      return { status: 'failed', error: err.message };
    }
  }
}
