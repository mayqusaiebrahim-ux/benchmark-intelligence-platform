/**
 * Anti-Bot detectors — turns a raw navigation outcome (either a thrown
 * Playwright error, or a real response + rendered page) into a structured
 * classification: what protection (if any) was hit, how confident we are,
 * what evidence supports it, and whether it's worth trying another strategy.
 */

import { NETWORK_ERROR_PATTERNS, BLOCK_STATUS_CODES, PERMANENT_STATUS_CODES, CONTENT_SIGNATURES } from './signatures.js';

/**
 * classifyNetworkError — for when page.goto() itself throws (no response).
 * @returns {{ type: 'network_error', id: string, permanent: boolean, evidence: string[] }}
 */
export function classifyNetworkError(err) {
  const message = String(err?.message || err || '');
  for (const pattern of NETWORK_ERROR_PATTERNS) {
    if (pattern.regex.test(message)) {
      return { type: 'network_error', id: pattern.id, permanent: pattern.permanent, evidence: [message.split('\n')[0]] };
    }
  }
  return { type: 'network_error', id: 'unknown_network_error', permanent: false, evidence: [message.split('\n')[0]] };
}

// A real, rendered homepage — even a sparse one — has more than this many
// characters of visible body text. Below it, "no protection signature
// matched" doesn't mean the capture is good; it more often means the page
// hasn't finished rendering (common on JS-framework homepages where `load`
// fires before client-side hydration paints anything).
const MIN_MEANINGFUL_BODY_LENGTH = 40;

/**
 * classifyResponse — for when navigation completed and we have a real page
 * to inspect. Checks response headers for known bot-management vendors,
 * then status code, then page content against CONTENT_SIGNATURES, then
 * whether anything actually rendered at all.
 * @param {object} info - { status, headers, title, bodyText, html }
 *   `html` (optional) is the raw page.content() source, not just rendered
 *   innerText — some challenge pages (confirmed real case: Imperva's
 *   "Pardon Our Interruption") put their identifying text inside a
 *   <noscript> tag, which never shows up in title/innerText under a real
 *   browser. Content-signature matching checks html when it's provided, in
 *   addition to title+bodyText, specifically to still catch those.
 * @returns {{ type: 'clean' } | { type: 'empty_render', id: string, permanent: false, evidence: string[] } | { type: 'protection', id: string, permanent: boolean, evidence: string[], vendor: string|null }}
 */
export function classifyResponse({ status, headers = {}, title = '', bodyText = '', html = '' }) {
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  const vendor = detectVendorFromHeaders(lowerHeaders);
  const haystack = `${title}\n${bodyText}\n${html}`.toLowerCase().slice(0, 8000); // cap — this is a classifier, not a full-text search

  for (const [id, permanent, regex] of CONTENT_SIGNATURES) {
    const match = haystack.match(regex);
    if (match) {
      return { type: 'protection', id, permanent, vendor, evidence: [`matched "${match[0].slice(0, 80)}" in page content`, ...(vendor ? [`vendor header signature: ${vendor}`] : [])] };
    }
  }

  if (status != null) {
    if (PERMANENT_STATUS_CODES.has(status)) {
      return { type: 'protection', id: `http_${status}`, permanent: true, vendor, evidence: [`HTTP ${status}`] };
    }
    if (BLOCK_STATUS_CODES.has(status)) {
      return { type: 'protection', id: `http_${status}`, permanent: false, vendor, evidence: [`HTTP ${status}`, ...(vendor ? [`vendor header signature: ${vendor}`] : [])] };
    }
  }

  if (vendor && status != null && !BLOCK_STATUS_CODES.has(status) && !PERMANENT_STATUS_CODES.has(status)) {
    // A bot-management vendor's header is present, but the status is healthy
    // and no challenge content matched — the request already passed
    // whatever check that vendor runs. V1 Stabilization fix: this used to be
    // classified 'protection' ('vendor_present_uncertain'), which caused
    // real, unblocked homepages to be wrongly treated as protected and
    // stopped before analysis. A present vendor header alone is not evidence
    // of an active block.
    return { type: 'clean' };
  }

  if (vendor) {
    return { type: 'protection', id: 'vendor_present_uncertain', permanent: false, vendor, evidence: [`vendor header signature: ${vendor}`, `HTTP ${status}`] };
  }

  if (status === 200 && bodyText.trim().length < MIN_MEANINGFUL_BODY_LENGTH) {
    // Not blocked, not a challenge page — just empty. Treat as "try the
    // next strategy" rather than accepting a blank capture as the homepage.
    return {
      type: 'empty_render',
      id: 'empty_render',
      permanent: false,
      vendor: null,
      evidence: [`page body text was only ${bodyText.trim().length} characters after rendering — looks like a blank or unfinished page, not the real homepage`],
    };
  }

  return { type: 'clean' };
}

function detectVendorFromHeaders(lowerHeaders) {
  if ('cf-ray' in lowerHeaders || 'cf-mitigated' in lowerHeaders || (lowerHeaders.server || '').includes('cloudflare')) return 'cloudflare';
  if (Object.keys(lowerHeaders).some((h) => h.startsWith('x-akamai'))) return 'akamai';
  if ('x-px-block-reason' in lowerHeaders || 'x-px-uuid' in lowerHeaders) return 'perimeterx';
  // x-iinfo is Imperva Incapsula's own diagnostic header — confirmed present
  // on Saudia's real "Pardon Our Interruption" challenge response.
  if ('x-iinfo' in lowerHeaders || (lowerHeaders['x-cdn'] || '').includes('incapsula')) return 'imperva';
  return null;
}
