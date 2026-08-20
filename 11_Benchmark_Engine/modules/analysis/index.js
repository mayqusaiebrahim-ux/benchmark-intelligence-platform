/**
 * Vision UX Analysis — entry point.
 * Input: a homepage screenshot + a Discovery Report. Output: a structured,
 * qualitative UX analysis. No scoring, no comparison, no benchmarking — see
 * README.md. The only missing piece is the actual model call
 * (visionModelClient.js), which throws until a later sprint wires it up.
 */

import { buildVisionAnalysisPrompt } from './promptBuilder.js';
import { callVisionModel } from './visionModelClient.js';
import { parseVisionAnalysisResponse } from './responseParser.js';

const MODEL_NAME = 'gpt-5-vision'; // Placeholder identifier — not yet called.

/**
 * analyzeHomepageUX — accepts { screenshotPath, discoveryReport, companySlug?,
 * companyName?, url? }, returns a VisionUXAnalysisOutput matching
 * contracts/vision_ux_analysis.schema.json.
 */
export async function analyzeHomepageUX({ screenshotPath, discoveryReport, companySlug = null, companyName = null, url = null }) {
  const payload = buildVisionAnalysisPrompt({ screenshotPath, discoveryReport });
  const rawResponse = await callVisionModel(payload); // Throws until the model client is implemented.
  const findings = parseVisionAnalysisResponse(rawResponse);

  return {
    schema_version: '0.1.0',
    company_slug: companySlug,
    company_name: companyName,
    url,
    screenshot_path: screenshotPath,
    model: MODEL_NAME,
    analyzed_at: new Date().toISOString(),
    findings,
  };
}
