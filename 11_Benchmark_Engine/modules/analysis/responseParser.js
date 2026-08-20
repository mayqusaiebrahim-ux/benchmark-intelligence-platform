/**
 * Vision UX Analysis — response parsing/validation.
 * Turns the model's raw JSON text into a validated Findings object matching
 * contracts/vision_ux_analysis.schema.json. Pure — no network access, no
 * knowledge of which model produced the text.
 */

import { ANALYSIS_CATEGORIES } from './promptBuilder.js';

const LIST_FIELDS = ['top_5_ux_strengths', 'top_5_ux_improvement_opportunities'];

export function parseVisionAnalysisResponse(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Vision model response was not valid JSON.');
  }

  const missingText = ANALYSIS_CATEGORIES.filter(key => typeof parsed[key] !== 'string' || !parsed[key].trim());
  if (missingText.length) {
    throw new Error(`Vision model response is missing required fields: ${missingText.join(', ')}`);
  }

  for (const key of LIST_FIELDS) {
    if (!Array.isArray(parsed[key]) || parsed[key].length !== 5 || parsed[key].some(v => typeof v !== 'string' || !v.trim())) {
      throw new Error(`Vision model response's "${key}" must be an array of exactly 5 non-empty strings.`);
    }
  }

  const findings = {};
  for (const key of ANALYSIS_CATEGORIES) findings[key] = parsed[key];
  for (const key of LIST_FIELDS) findings[key] = parsed[key];
  return findings;
}
