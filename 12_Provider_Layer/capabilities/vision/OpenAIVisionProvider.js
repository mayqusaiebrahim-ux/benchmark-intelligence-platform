/**
 * OpenAIVisionProvider — the default Vision provider.
 *
 * analyze() (Sprint 15): delegates to the existing, unmodified trio in
 * 11_Benchmark_Engine/modules/analysis/ — unchanged, see VisionProvider.js.
 *
 * describe() (Sprint 21): reuses ONLY visionModelClient.js's
 * callVisionModel() — the generic, payload-agnostic { system, messages } ->
 * text call, unrelated to discoveryReport or the UX-narrative schema. Does
 * NOT reuse promptBuilder.js/responseParser.js — both are hard-coupled to
 * discoveryReport (required, non-optional in
 * contracts/vision_ux_analysis.schema.json) and to a 10-key
 * additionalProperties:false Findings shape that structurally cannot hold
 * detection fields. A small, separate prompt/parse pair lives here instead,
 * matching PlaywrightScreenshotProvider.js's precedent of keeping a
 * Provider's own reimplemented helpers inline in the same file rather than
 * a shared/imported module — nothing here is shared across providers.
 *
 * Storage: writes its own JSON artifact to the same SCREENSHOTS_DIR
 * (03_Screenshots/, flat) PlaywrightScreenshotProvider.js already writes
 * PNGs to, matching that Sprint 20 "Provider owns writing its own
 * artifact" precedent exactly. slugify()/timestampForFilename() are
 * reimplemented here rather than imported — third occurrence of this
 * duplication (after PlaywrightNavigationProvider.js's navigate() idiom and
 * PlaywrightScreenshotProvider.js's own copy of these same two helpers) —
 * intentional: matches every prior sprint's choice to duplicate a few lines
 * rather than export a private helper from a frozen Engine file.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { VisionProvider } from './VisionProvider.js';
import { buildVisionAnalysisPrompt } from '../../../11_Benchmark_Engine/modules/analysis/promptBuilder.js';
import { callVisionModel } from '../../../11_Benchmark_Engine/modules/analysis/visionModelClient.js';
import { parseVisionAnalysisResponse } from '../../../11_Benchmark_Engine/modules/analysis/responseParser.js';
import { SCREENSHOTS_DIR } from '../../../11_Benchmark_Engine/modules/vision/screenshotRunner.js';

const DETECTION_FIELDS = [
  'page_type',
  'ui_sections',
  'navigation_detected',
  'cards_detected',
  'forms_detected',
  'buttons_detected',
  'banners_detected',
  'search_widgets_detected',
  'filters_detected',
  'ai_features_detected',
  'confidence',
];

const DETECTION_SYSTEM_PROMPT = `You are a structural UI detector analyzing a single
website homepage screenshot. Describe only what is visually present — page type,
UI sections, navigation, cards, forms, buttons, banners, search widgets, filters,
and any AI-feature affordances. Do NOT rate, score, recommend, suggest improvements,
write a report, or compare this page to any other company or product. Vision
describes; it does not interpret or judge. Respond with strict JSON matching the
requested schema, and nothing else.`;

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function encodeScreenshotAsDataUri(screenshotPath) {
  const buffer = readFileSync(screenshotPath);
  const ext = extname(screenshotPath).replace('.', '') || 'png';
  return `data:image/${ext};base64,${buffer.toString('base64')}`;
}

function buildDetectionPrompt({ screenshotPath }) {
  const imageDataUri = encodeScreenshotAsDataUri(screenshotPath);
  const userInstruction = `Analyze the attached homepage screenshot. Return a JSON
object with exactly these keys: ${DETECTION_FIELDS.join(', ')}. Each *_detected key
should be an array (empty if none found) describing what was structurally observed
(e.g. navigation_detected: [{label, position}]). page_type is a short string.
confidence is one of "low", "medium", "high". Do not include any key not listed
above. Do not include opinions, ratings, or suggestions of any kind.`;

  return {
    system: DETECTION_SYSTEM_PROMPT,
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

function parseDetectionResponse(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Vision model response was not valid JSON.');
  }

  const missing = DETECTION_FIELDS.filter((key) => !(key in parsed));
  if (missing.length) {
    throw new Error(`Vision model response is missing required fields: ${missing.join(', ')}`);
  }

  const findings = {};
  for (const key of DETECTION_FIELDS) findings[key] = parsed[key];
  return findings;
}

function writeDetectionFindings({ findings, companySlug, screenshotPath, url, title }) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const slug = slugify(companySlug || 'unknown');
  const stamp = timestampForFilename();
  const jsonPath = join(SCREENSHOTS_DIR, `${slug}_${stamp}_vision.json`);

  const record = {
    company_slug: companySlug || null,
    url: url || null,
    title: title || null,
    screenshot_path: screenshotPath,
    model: process.env.OPENAI_VISION_MODEL || 'gpt-5',
    analyzed_at: new Date().toISOString(),
    findings,
  };

  writeFileSync(jsonPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return jsonPath;
}

export class OpenAIVisionProvider extends VisionProvider {
  async analyze({ screenshotPath, discoveryReport }) {
    const payload = buildVisionAnalysisPrompt({ screenshotPath, discoveryReport });
    const rawResponse = await callVisionModel(payload);
    return parseVisionAnalysisResponse(rawResponse);
  }

  async describe({ screenshotPath, companySlug, url, title }) {
    const startedAtMs = Date.now();
    const timing = () => ({
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
    });

    try {
      const payload = buildDetectionPrompt({ screenshotPath });
      const rawResponse = await callVisionModel(payload);
      const findings = parseDetectionResponse(rawResponse);
      const jsonPath = writeDetectionFindings({ findings, companySlug, screenshotPath, url, title });
      return { success: true, findings, jsonPath, timing: timing(), error: null };
    } catch (err) {
      return { success: false, findings: null, jsonPath: null, timing: timing(), error: err.message };
    }
  }
}
