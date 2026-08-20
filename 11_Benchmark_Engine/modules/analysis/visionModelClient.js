/**
 * Vision UX Analysis — model client.
 * Sends the { system, messages } payload from promptBuilder.js to OpenAI's
 * Responses API and returns the model's raw text response only. No parsing —
 * that stays in responseParser.js, unchanged.
 */

import OpenAI from 'openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'gpt-5';

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

export async function callVisionModel(payload) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to 11_Benchmark_Engine/.env.');
  }

  const client = new OpenAI();

  const response = await client.responses.create({
    model: process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL,
    instructions: payload.system,
    input: toResponsesInput(payload.messages),
  });

  return response.output_text;
}
