/**
 * blankCapture — is the captured evidence an empty page?
 *
 * Live finding (req_1792498429566_ca7a7670, Saudia Homepage on Render's
 * free plan): the screenshot was uniformly white, Vision said so
 * ("page_type: blank viewport", every *_detected list empty), and the run was
 * still reported "Completed successfully — output verified" with
 * "Feature found: Yes". A blank page is not evidence of anything.
 *
 * Deliberately conservative — BOTH must hold, so a sparse but real page is
 * never rejected:
 *   - Vision detected no UI element of any kind, and
 *   - Vision's own page type says the page is blank / empty / not rendered.
 */
const ELEMENT_LISTS = [
  'ui_sections', 'navigation_detected', 'cards_detected', 'forms_detected', 'buttons_detected',
  'banners_detected', 'search_widgets_detected', 'filters_detected', 'ai_features_detected',
];
const BLANK_TYPE = /\b(blank|empty|white|unrendered|not rendered|no content|loading)\b/i;

export function isBlankCapture(findings) {
  if (!findings || typeof findings !== 'object') return false;
  const noElements = ELEMENT_LISTS.every((k) => !Array.isArray(findings[k]) || findings[k].length === 0);
  return noElements && BLANK_TYPE.test(String(findings.page_type || ''));
}
