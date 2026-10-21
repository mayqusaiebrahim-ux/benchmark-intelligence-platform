/**
 * pageBlockDetector — decides whether a captured page is a bot-protection /
 * access-restricted interstitial instead of the real website.
 *
 * Why this exists: a Navigation Runner step that "loaded a page" was being
 * recorded as status:'success' even when that page was Emirates'
 * /error/accessrestricted.html ("The page you're trying to access is
 * restricted. Reference number: 18.a78ad7d4…"). That false success then
 * flowed into Vision and the report as if it were the homepage.
 *
 * It reuses the Anti-Bot module's own content signatures
 * (11_Benchmark_Engine/modules/antibot — imported, not modified) and adds:
 *   - URL patterns (…/accessrestricted…, …/access-denied…, …/captcha…)
 *   - wording the existing signatures miss (Akamai's "Reference number:
 *     18.a78ad7d4.1788244964.207c99df" format, "page … is restricted")
 *
 * False-positive guard: it matches on VISIBLE text only (scripts/styles
 * stripped — a normal page that merely loads a reCAPTCHA script is not a
 * block), and the generic signatures only count on short pages. Real
 * interstitials are a few hundred characters; real homepages and booking
 * pages are many thousands.
 */
import { classifyResponse } from '../../11_Benchmark_Engine/modules/antibot/detectors.js';

const BLOCK_URL = /(access[-_]?restricted|access[-_]?denied|accessdenied|\/blocked(?:[/?.#]|$)|captcha|\/challenge(?:[/?#]|$)|\/error\/(?:403|429)(?:[/?.#]|$))/i;

const EXTRA_TEXT_SIGNATURES = [
  ['access_restricted', /page you(?:'|’)?re trying to access is restricted|access to this page (?:is|has been) restricted/i],
  ['akamai_reference', /reference (?:number|#|no\.?)\s*:?\s*\d{1,3}\.[a-f0-9]{6,}\.\d{6,}/i],
  ['access_denied', /\baccess denied\b[\s\S]{0,160}\b(?:permission|not authori[sz]ed)\b/i],
  ['you_have_been_blocked', /\b(?:sorry, )?you have been blocked\b/i],
  ['security_check_required', /additional security check is required/i],
];

// Imperva's interstitial: the whole page is one iframe onto an
// _Incapsula_Resource challenge carrying an incident_id (live: Saudia served
// this to headless Chromium — a GeeTest "Additional security check is
// required" inside the frame, nothing in the top document). Normal
// Imperva-fronted pages also load _Incapsula_Resource scripts, so only the
// challenge iframe on a short page counts.
const IMPERVA_CHALLENGE_IFRAME = /<iframe\b[^>]*\bsrc="[^"]*_Incapsula_Resource\?[^"]*incident_id=/i;

// Vendor challenge pages are unambiguous at any length; generic wording
// ("captcha", "security check") only counts on a short, interstitial-sized page.
const VENDOR_IDS = new Set(['cloudflare_challenge', 'akamai_challenge', 'imperva_challenge', 'perimeterx_challenge', 'explicit_permanent_block']);
const SHORT_PAGE_CHARS = 6000;

export function htmlToVisibleText(html = '') {
  return String(html)
    .replace(/<(script|style|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
}

function noscriptText(html = '') {
  const parts = String(html).match(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi) || [];
  return parts.join(' ').slice(0, 4000);
}

/**
 * @param {{ url?: string, title?: string, html?: string, text?: string }} page
 * @returns {{ blocked: false } | { blocked: true, id: string, reason: string }}
 */
export function detectBlockedPage({ url = '', title = '', html = '', text } = {}) {
  if (url && BLOCK_URL.test(url)) {
    return { blocked: true, id: 'block_url', reason: `the page URL looks like a bot-protection / access-restricted page (${url})` };
  }

  const visible = typeof text === 'string' ? text : htmlToVisibleText(html);

  if (IMPERVA_CHALLENGE_IFRAME.test(String(html)) && visible.length < SHORT_PAGE_CHARS) {
    return { blocked: true, id: 'imperva_challenge', reason: 'bot protection detected (imperva_challenge: the page is an Imperva security-check iframe)' };
  }

  for (const [id, re] of EXTRA_TEXT_SIGNATURES) {
    const m = visible.match(re) || String(title).match(re);
    if (m && visible.length < SHORT_PAGE_CHARS * 2) {
      return { blocked: true, id, reason: `the page says "${m[0].slice(0, 90)}" — the site blocked the automated browser` };
    }
  }

  const verdict = classifyResponse({ title, bodyText: visible, html: noscriptText(html) });
  if (verdict.type === 'protection' && (VENDOR_IDS.has(verdict.id) || visible.length < SHORT_PAGE_CHARS)) {
    return { blocked: true, id: verdict.id, reason: `bot protection detected (${verdict.id}: ${(verdict.evidence || [])[0] || 'signature match'})` };
  }
  return { blocked: false };
}
