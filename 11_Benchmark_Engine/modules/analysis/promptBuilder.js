/**
 * Vision UX Analysis — prompt/payload construction.
 * Turns a homepage screenshot + Discovery Report into the exact multimodal
 * request payload a vision-capable model would receive. No network call here
 * — see visionModelClient.js for the (stubbed) call itself.
 */

import { readFileSync } from 'fs';
import { extname } from 'path';

export const ANALYSIS_CATEGORIES = [
  'first_impression',
  'visual_hierarchy',
  'main_cta_effectiveness',
  'navigation_clarity',
  'ai_feature_visibility',
  'information_density',
  'trust_signals',
  'accessibility_observations',
];

const SYSTEM_PROMPT = `You are a senior UX researcher analyzing a single travel-product
homepage screenshot. Describe what you observe. Do not assign scores or ratings.
Do not compare this product to any other company. Do not produce a benchmark
verdict — only a qualitative analysis of this one homepage. Respond with strict
JSON matching the requested schema, and nothing else.`;

function encodeScreenshotAsDataUri(screenshotPath) {
  const buffer = readFileSync(screenshotPath);
  const ext = extname(screenshotPath).replace('.', '') || 'png';
  return `data:image/${ext};base64,${buffer.toString('base64')}`;
}

/**
 * Grounds the model in what Discovery already established structurally, so it
 * isn't re-guessing website_type or AI-surface existence from pixels alone —
 * it's asked to describe what's visually apparent, informed by what's known.
 */
function summarizeDiscoveryContext(discoveryReport) {
  return {
    website_type: discoveryReport.website_type,
    primary_user_goals: discoveryReport.primary_user_goals,
    detected_ai_capabilities: discoveryReport.detected_ai_capabilities,
    search_capability: discoveryReport.search_capability,
    obstacles: discoveryReport.obstacles,
    discovery_confidence: discoveryReport.confidence,
  };
}

/**
 * buildVisionAnalysisPrompt — the data-flow centerpiece: assembles the exact
 * { system, messages } payload a future model call will receive.
 */
export function buildVisionAnalysisPrompt({ screenshotPath, discoveryReport }) {
  const imageDataUri = encodeScreenshotAsDataUri(screenshotPath);
  const discoveryContext = summarizeDiscoveryContext(discoveryReport);

  const userInstruction = `Analyze the attached homepage screenshot.

Discovery already observed the following structurally — use it as grounding
context, not as facts to simply restate:
${JSON.stringify(discoveryContext, null, 2)}

Return a JSON object with exactly these keys: ${ANALYSIS_CATEGORIES.join(', ')},
top_5_ux_strengths (array of exactly 5 short strings), and
top_5_ux_improvement_opportunities (array of exactly 5 short strings). Every
field must be grounded in what is visually apparent in the screenshot.`;

  return {
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userInstruction },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ],
      },
    ],
  };
}
