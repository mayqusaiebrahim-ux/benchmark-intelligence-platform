/**
 * autonomous_navigator/genericVerifier — INDEPENDENT, domain-free "did we reach
 * the requested experience?" check for ANY feature on ANY site.
 *
 * The airline feature detectors (goal_navigator/featureDetectors.js) stay as
 * the authoritative check for their known target set. This module is the
 * fallback for everything else ("Checkout", "Sign up", "Pricing", "Quote",
 * "Account creation", arbitrary labels). It never assumes a domain.
 *
 * Signals (all generic):
 *   - the requested feature's key words appear in the page's headings / URL
 *     path / prominent visible text
 *   - the page's own "kind" (login / signup / checkout / cart / payment / form
 *     / results / listing / confirmation) matches the feature's intent
 *   - a form with several fields is present when the feature implies data entry
 */

const STOP_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'your', 'my', 'page', 'screen', 'step', 'experience', 'details', 'detail', 'section']);

function keyWords(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// Generic page "kind" from what's visible — no domain knowledge. Order matters:
// more specific / broader-concept kinds first.
const KIND_PATTERNS = [
  ['login', /\b(sign in|log in|login|welcome back)\b/i, (o) => hasField(o, 'password')],
  ['signup', /\b(sign ?up|create (an?|your|a new) account|create account|register|get started|join (now|us|free|today))\b/i, (o) => hasField(o, 'email') && (hasField(o, 'first_name') || hasField(o, 'password') || hasField(o, 'full_name'))],
  ['cart', /\b(cart|basket|shopping bag|proceed to checkout)\b/i, (o) => /\b(subtotal|remove|quantity|your (items|order|bag))\b/i.test(`${(o.headings || []).join(' ')} ${o.bodyText || ''}`)],
  ['checkout', /\b(checkout|check ?out|place (your )?order|order summary|delivery (address|details)|shipping (address|method)|proceed to (payment|checkout))\b/i, () => true],
  ['payment', /\b(how would you like to pay|card number|cvv|order total|amount (due|payable)|total to pay|select a payment method|pay(ment)? (details|information))\b/i, () => true],
  ['confirmation', /\b(thank you|order (confirmed|placed)|confirmation|you're all set|booking (confirmed|reference))\b/i, () => true],
  ['results', /\b(results|listings?|we found|showing \d+|\d+ (results|options|properties|flights|items))\b/i, (o) => count(o) >= 3],
  ['form', /\b(please (enter|provide|fill)|required fields?|your (details|information))\b/i, (o) => (o.fields || []).length >= 3],
];

function hasField(o, sem) { return (o.fields || []).some((f) => (f.semantic || '') === sem); }
function count(o) {
  const c = o.counts || {};
  return Math.max(Number(c.flightCards || 0), Number(c.fareCards || 0), Number(c.priceTags || 0), (o.controls || []).filter((x) => /\b(select|choose|view|book|add)\b/i.test(x.name || '')).length);
}

export function pageKind(observation) {
  const o = observation || {};
  const text = `${(o.headings || []).join(' ')} ${o.bodyText || ''}`.toLowerCase();
  for (const [kind, re, extra] of KIND_PATTERNS) {
    if (re.test(text) && (!extra || extra(o))) return kind;
  }
  if ((o.fields || []).length >= 4) return 'form';
  return 'unknown';
}

// Which page kinds satisfy which feature intent.
const FEATURE_KIND_HINTS = [
  [/(sign ?in|log ?in|login)/, ['login']],
  [/(sign ?up|register|create account|account creation|get started|join)/, ['signup']],
  [/(payment|billing)/, ['payment', 'checkout']],
  [/(checkout|check ?out|place order)/, ['checkout', 'payment']],
  [/(cart|basket|bag)/, ['cart']],
  [/(results|listing|search results)/, ['results']],
  [/(passenger|traveller|traveler|guest|contact details|your details)/, ['form']],
  [/(booking|reservation|appointment|quote|enquiry|application)/, ['form', 'checkout']],
];

/**
 * @returns {{ reached, confidence: 'none'|'low'|'medium'|'high', signals: string[] }}
 */
export function genericVerify(observation, featureLabel) {
  const o = observation || {};
  const words = keyWords(featureLabel);
  const signals = [];
  let score = 0;

  const hayHeadings = (o.headings || []).join(' • ').toLowerCase();
  const hayUrl = String(o.url || '').toLowerCase();
  const hayText = String(o.bodyText || '').toLowerCase().slice(0, 4000);

  const inHeading = words.filter((w) => hayHeadings.includes(w));
  const inUrl = words.filter((w) => hayUrl.includes(w));
  const inText = words.filter((w) => hayText.includes(w));

  if (words.length && inHeading.length >= Math.ceil(words.length / 2)) { score += 3; signals.push(`heading matches "${inHeading.join(' ')}"`); }
  else if (inHeading.length) { score += 1; signals.push(`heading mentions "${inHeading.join(' ')}"`); }
  if (inUrl.length) { score += 1; signals.push(`url path mentions "${inUrl.join(' ')}"`); }
  if (words.length && inText.length >= Math.ceil(words.length / 2) && !inHeading.length) { score += 1; signals.push(`visible text mentions "${inText.join(' ')}"`); }

  const kind = pageKind(o);
  const wantKinds = (FEATURE_KIND_HINTS.find(([re]) => re.test(String(featureLabel || '').toLowerCase())) || [null, []])[1];
  if (wantKinds.length && wantKinds.includes(kind)) { score += 3; signals.push(`page kind "${kind}" matches the requested feature`); }
  else if (kind !== 'unknown') { signals.push(`page kind detected: "${kind}"`); }

  // a substantial form present, when the feature implies data entry
  const fieldCount = (o.fields || []).filter((f) => f.visible !== false).length;
  if (fieldCount >= 4 && /(details|checkout|payment|booking|signup|sign up|register|quote|application|passenger|contact)/i.test(String(featureLabel || ''))) {
    score += 1; signals.push(`${fieldCount} form fields present`);
  }

  const confidence = score >= 5 ? 'high' : score >= 3 ? 'medium' : score >= 1 ? 'low' : 'none';
  return { reached: confidence === 'high' || confidence === 'medium', confidence, signals, kind };
}

/** Generic fingerprint of the page state — for the universal stuck detector. */
export function pageStateFingerprint(observation) {
  const o = observation || {};
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const parts = [
    norm(o.url),
    (o.headings || []).map(norm).sort().join('|'),
    (o.fields || []).map((f) => `${f.semantic || norm(f.label || f.name || f.placeholder)}:${f.hasValue ? 'v' : ''}`).sort().join(','),
    (o.controls || o.buttons || []).map((c) => norm(typeof c === 'string' ? c : c.name)).sort().join(','),
    norm(o.bodyText).slice(0, 500),
    Object.entries(o.counts || {}).map(([k, v]) => `${k}=${v}`).sort().join(','),
  ];
  // small, order-independent digest
  let h = 0;
  const str = parts.join('§');
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return `${(o.url || '').split('?')[0]}#${(h >>> 0).toString(36)}`;
}
