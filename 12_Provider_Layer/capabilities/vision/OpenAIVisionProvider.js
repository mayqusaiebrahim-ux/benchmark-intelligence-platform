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
  'observations',
  'uncertainties',
  'confidence',
];

const DETECTION_SYSTEM_PROMPT = `You are a structural UI detector analyzing ONE
screenshot of ONE web page. Your only job is evidence extraction: describe what is
literally visible in this single image — page type, UI sections, navigation, cards,
forms, buttons, banners, search widgets, filters, and any AI-feature affordances.

You are NOT a UX critic. Do NOT rate, score, recommend, suggest improvements, write
a report, or compare this page to any other company or product. Vision describes
pixels; it does not interpret intent or judge quality.

You must NOT state or infer any of the following — none of it is visible in a
screenshot:
- how the user got here: traffic source, paid search, a "Google ad", a campaign,
  the referrer, or the previous page
- anything below the fold or outside the captured viewport
- the result of any interaction that was not performed (menus not opened, forms
  not submitted, hovers, scrolls)
- personalization or logged-in state unless a name/account/tailored content is
  literally on screen
- business strategy, intent, or motivation
- the ABSENCE of a feature site-wide. If something is not in frame, that is
  "not visible in this screenshot", never "the site does not have it".

Separate what you can see from what you cannot: put confident visible facts in
"observations", and put anything ambiguous, cut off, partially obscured, or
uncertain in "uncertainties". Respond with strict JSON matching the requested
schema, and nothing else.`;

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
  const userInstruction = `Analyze the attached screenshot of a single web page
viewport. Return a JSON object with exactly these keys: ${DETECTION_FIELDS.join(', ')}.
Each *_detected key is an array (empty if none found) describing what is
structurally visible (e.g. navigation_detected: [{label, position}]). page_type is
a short string. observations is an array of short strings — confident facts you can
literally see in this image. uncertainties is an array of short strings — anything
cut off at a viewport edge, obscured (e.g. by an overlay/consent banner), ambiguous,
or that you cannot determine from this one image. confidence is one of "low",
"medium", "high". Do not include any key not listed above. Do not include opinions,
ratings, suggestions, or any claim about traffic source, referrer, below-the-fold
content, untested interactions, or features being absent from the site.`;

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

  // observations / uncertainties are grounding aids — tolerate their absence
  // (default to []) rather than failing the whole Vision call over them.
  const SOFT = new Set(['observations', 'uncertainties']);
  const missing = DETECTION_FIELDS.filter((key) => !(key in parsed) && !SOFT.has(key));
  if (missing.length) {
    throw new Error(`Vision model response is missing required fields: ${missing.join(', ')}`);
  }

  const findings = {};
  for (const key of DETECTION_FIELDS) {
    findings[key] = key in parsed ? parsed[key] : (SOFT.has(key) ? [] : parsed[key]);
  }
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
