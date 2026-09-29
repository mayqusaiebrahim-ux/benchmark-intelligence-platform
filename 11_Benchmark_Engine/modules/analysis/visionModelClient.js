/**
 * Vision UX Analysis — model client.
 * Sends the { system, messages } payload from promptBuilder.js to OpenAI's
 * Responses API and returns the model's raw text response only. No parsing —
 * that stays in responseParser.js, unchanged.
 */

import OpenAI from 'openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError } from '../../../shared/logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Cost control (V1): cheap default, env override only, no fallback to a more
// expensive model.
export const DEFAULT_VISION_MODEL = 'gpt-5.6-luna';
const DEFAULT_MODEL = DEFAULT_VISION_MODEL;

/** { model, modelSource: 'env'|'default' } — resolved per call, after .env loads. */
export function resolveVisionModel() {
  const fromEnv = (process.env.OPENAI_VISION_MODEL || '').trim();
  return fromEnv ? { model: fromEnv, modelSource: 'env' } : { model: DEFAULT_MODEL, modelSource: 'default' };
}

try {
  // 11_Benchmark_Engine/.env — two levels up from modules/analysis/.
  process.loadEnvFile(join(__dirname, '..', '..', '.env'));
} catch {
  // No .env file present — fall back to whatever is already in process.env.
}

function toResponsesInput(messages) {
  return messages.map(message => ({
    role: message.role,
    content: message.content.map(part => {
      if (part.type === 'text') return { type: 'input_text', text: part.text };
      if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url.url };
      throw new Error(`Unsupported content part type: ${part.type}`);
    }),
  }));
}

export async function callVisionModel(payload, { stage = 'vision' } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to 11_Benchmark_Engine/.env.');
  }

  const { model, modelSource } = resolveVisionModel();
  // One Vision call = one HTTP request: the SDK's default of 2 automatic
  // retries is disabled on this client only.
  const client = new OpenAI({ maxRetries: 0 });

  logInfo('OpenAI vision request starting', { stage, model, modelSource, maxRetries: 0 });
  let response;
  try {
    response = await client.responses.create({
      model,
      instructions: payload.system,
      input: toResponsesInput(payload.messages),
    });
  } catch (err) {
    logError('OpenAI vision request threw', err, { stage, model, modelSource, requestId: err.requestID || null });
    throw err;
  }
  logInfo('OpenAI vision request finished', {
    stage, model, modelSource, requestId: response._request_id || null, responseId: response.id || null,
  });

  return response.output_text;
}
