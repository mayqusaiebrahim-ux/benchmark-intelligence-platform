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
 *   - a real, currently-operable control/field names the concept (structural
 *     evidence — see WORD-BOUNDARY MATCHING and CONCEPT VS ACTION below)
 *
 * This module is intentionally CONSERVATIVE: a false negative can later be
 * resolved by a future AI semantic-verification layer (see verdict below); a
 * false positive cannot be un-done — it stops navigation on the wrong page.
 * So every matching rule here must be lexically/structurally justifiable
 * without guessing at meaning. No feature ontology, no synonym dictionary
 * ("baggage" == "luggage", "meal" == "food") belongs in this file — that is
 * exactly the kind of semantic leap reserved for the future AI layer.
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'your', 'my', 'page', 'screen', 'step',
  'experience', 'details', 'detail', 'section',
  // generic wh-/function words: contribute no identifying concept on their own
  'where', 'which', 'how', 'when', 'what', 'who', 'that', 'this', 'with', 'from', 'can', 'do', 'does',
]);

function keyWords(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/-/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// ── WORD-BOUNDARY MATCHING ──────────────────────────────────────────────
// The previous implementation compared words with plain substring
// `.includes()`, which matches ANYWHERE inside a longer word — "seat" is a
// substring of "Seattle", "bag" of "baggage", "add" of "address", "pay" of
// "repayment", "fare" of "farewell", "meal" of "mealtime". None of those are
// the same concept; several are unrelated words that merely share letters.
// Proven by direct trace (Phase 1 audit) and by the "false-positive audit"
// tests below.
//
// Real-world requests and real-world UI copy DO differ by ordinary English
// inflection though ("seat" -> "seats", "select" -> "selection", "choose" ->
// "choosing") — a purely exact/boundary match would reject those too. So
// tokenize() splits on Unicode word boundaries (never inside a word), and
// tokenMatches() allows only a small, fixed set of GENERIC morphological
// suffixes (plural -s/-es, -ing/-ed with silent-e restoration, -ion/-ions,
// -er/-ers) — not a lookup table of related concepts, just how English
// regularly inflects the SAME word. "address" does not reduce to "add"
// under this rule (its remainder "ress" is not a recognized suffix), so it
// is correctly rejected; "selection" does reduce to "select" (remainder
// "ion" is a recognized suffix), so it is correctly accepted.
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

function stems(w) {
  const out = new Set([w]);
  if (w.endsWith('ies') && w.length > 4) out.add(`${w.slice(0, -3)}y`);
  else if (w.endsWith('es') && w.length > 3) out.add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) out.add(w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 5) { const r = w.slice(0, -3); out.add(r); out.add(`${r}e`); }
  if (w.endsWith('ed') && w.length > 4) { const r = w.slice(0, -2); out.add(r); out.add(`${r}e`); }
  if (w.endsWith('ions') && w.length > 6) out.add(w.slice(0, -4));
  else if (w.endsWith('ion') && w.length > 5) out.add(w.slice(0, -3));
  if (w.endsWith('ers') && w.length > 5) out.add(w.slice(0, -3));
  else if (w.endsWith('er') && w.length > 4) out.add(w.slice(0, -2));
  return out;
}

/** Same word, allowing for the generic English inflections above — nothing else. */
function tokenMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = stems(a);
  if (sa.has(b)) return true;
  const sb = stems(b);
  if (sb.has(a)) return true;
  for (const x of sa) if (sb.has(x)) return true;
  return false;
}

function anyTokenMatches(reqWords, hayTokens) {
  return reqWords.filter((w) => hayTokens.some((t) => tokenMatches(w, t)));
}

// Generic page "kind" from what's visible — no domain knowledge. Order matters:
// more specific / broader-concept kinds first.
const KIND_PATTERNS = [
  ['login', /\b(sign in|log in|login|welcome back)\b/i, (o) => hasField(o, 'password')],
  ['signup', /\b(sign ?up|create (an?|your|a new) account|create account|register|get started|join (now|us|free|today))\b/i, (o) => hasField(o, 'email') && (hasField(o, 'first_name') || hasField(o, 'password') || hasField(o, 'full_name'))],
  ['cart', /\b(cart|basket|shopping bag|proceed to checkout)\b/i, (o) => /\b(subtotal|remove|quantity|your (items|order|bag))\b/i.test(`${(o.headings || []).join(' ')} ${o.bodyText || ''}`)],
  ['checkout', /\b(checkout|check ?out|place (your )?order|order summary|delivery (address|details)|shipping (address|method)|proceed to (payment|checkout))\b/i, () => true],
  ['payment', /\b(how would you like to pay|card number|cvv|order total|amount (due|payable)|total to pay|select a payment method|pay(ment)? (details|information))\b/i, () => true],
  // PROVEN false positive (real Alaska Airlines /book/guest-info run, a
  // genuine Passenger Details page): the bare word "confirmation" alone
  // matched — almost certainly a multi-step progress breadcrumb naming a
  // FUTURE step ("Passengers → Seats → Payment → Confirmation"), not the
  // current page. Now requires "confirmation" to be qualified (a number,
  // code, or email) so a real confirmation page — "confirmation number",
  // "booking confirmation email sent" — still matches, but a step label
  // mentioning the word in passing does not.
  ['confirmation', /\b(thank you|order (confirmed|placed)|you're all set|booking (confirmed|reference)|confirmation (number|code|email|sent)|(order|booking) confirmation\b)/i, () => true],
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

// Kinds that identify a page on their own. "form" is deliberately NOT here:
// pageKind() falls back to "form" for any page with 4+ fields, so it says
// "this page has inputs", not "this page is the requested experience".
const SPECIFIC_KINDS = new Set(['login', 'signup', 'cart', 'checkout', 'payment', 'confirmation', 'results']);

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

// A small, UNIVERSAL, domain-free UI-action vocabulary — not one entry per
// feature category (no "seat words", "baggage words", "meal words" list;
// that would just move the scalability problem into this file). These are
// the generic verbs any interactive web UI uses to let a user DO something,
// on any site, in any industry. Used only to tell "a control that lets you
// act on the requested concept" apart from "a passing mention of it".
const ACTION_WORDS = new Set(['select', 'choose', 'add', 'enter', 'review', 'pay', 'confirm', 'continue', 'edit', 'remove', 'update', 'change', 'submit', 'proceed', 'book', 'reserve', 'apply']);

// ── CONCEPT VS ACTION ────────────────────────────────────────────────────
// isActionWord() uses the FULL morphological match (tokenMatches, including
// -ion/-er nominalizations) to decide whether a word from the REQUEST is
// action vocabulary rather than a distinguishing concept. This is what
// keeps "meal selection" from being identified by the word "selection"
// alone matching an unrelated "Select flight" control — "selection" is
// recognized as the SAME word as the generic verb "select" and excluded
// from the concept set, leaving only "meal" (the actual, distinguishing
// noun) to do the identifying.
function isActionWord(w) {
  for (const a of ACTION_WORDS) if (tokenMatches(a, w)) return true;
  return false;
}

// verbMatches() is deliberately STRICTER than tokenMatches(): it recognizes
// only genuine verb inflections (exact word, plural/3rd-person -s/-es,
// -ing / -ed with silent-e restoration) and NOT -ion/-er nominalizations.
// It is used only to decide whether a CONTROL demonstrates real, present
// actionability. A control's accessible name containing "selection" (a
// noun — "Seat Selection", as in a marketing link's label) is not treated
// as proof that the control performs an action; a name containing "select"
// or "selecting" is. This is the generic distinction between a functional
// workflow control and an informational/marketing one that this file can
// make WITHOUT DOM role/tag data (which the current observation shape does
// not carry) — see targetVerifier.js's insertion-point comment for the
// (not yet implemented) AI layer that will resolve cases this cannot.
function verbMatches(actionWord, token) {
  if (token === actionWord) return true;
  if (token === `${actionWord}s`) return true;
  if (token === `${actionWord}es`) return true;
  if (token.endsWith('ing') && token.length > 4) {
    const root = token.slice(0, -3);
    if (root === actionWord || `${root}e` === actionWord) return true;
  }
  if (token.endsWith('ed') && token.length > 3) {
    const root = token.slice(0, -2);
    if (root === actionWord || `${root}e` === actionWord) return true;
  }
  return false;
}
function isVerbActionToken(token) {
  for (const a of ACTION_WORDS) if (verbMatches(a, token)) return true;
  return false;
}

/**
 * @returns {{
 *   reached: boolean,
 *   confidence: 'none'|'low'|'medium'|'high',
 *   verdict: 'match'|'no-match'|'ambiguous',
 *   signals: string[],
 *   kind: string,
 *   identified: boolean,
 *   lexicalMatch: boolean,
 *   structuralMatch: boolean,
 * }}
 *
 * verdict is an additive, non-breaking three-way summary for the future
 * hand-off to an AI semantic verifier (see targetVerifier.js):
 *   'match'     — reached === true.  Stop navigation, accept.
 *   'no-match'  — nothing matched at all (confidence 'none'). Confidently
 *                 keep navigating; this is not the target.
 *   'ambiguous' — some signal fired but not enough to safely accept
 *                 (confidence 'low', or a higher score that failed the
 *                 identification gate). This — and ONLY this — is the
 *                 candidate set for a future AI semantic verifier call.
 */
export function genericVerify(observation, featureLabel) {
  const o = observation || {};
  const words = keyWords(featureLabel);
  const conceptWords = words.filter((w) => !isActionWord(w));
  const signals = [];
  let score = 0;

  const headingTokens = tokenize((o.headings || []).join(' '));
  const urlTokens = tokenize(o.url);
  const textTokens = tokenize(String(o.bodyText || '').slice(0, 4000));

  const inHeading = anyTokenMatches(conceptWords, headingTokens);
  const inUrl = anyTokenMatches(conceptWords, urlTokens);
  const inText = anyTokenMatches(conceptWords, textTokens);

  // Structural evidence — NOT prose: the accessible names of actual
  // interactive controls and form fields on the page right now. For each
  // control whose name contains a REQUESTED CONCEPT word, also check
  // whether the control ALSO carries a genuine verb-form action word that
  // is a DIFFERENT token from the one that matched the concept — e.g.
  // requested "seats", control "Choose seat 14A": "seat" satisfies the
  // concept, "choose" (a distinct token) satisfies the action. A control
  // whose only action-shaped word IS the concept word's own nominalization
  // ("Learn about seat selection": concept match is "seat", the only other
  // candidate token is "selection", which is the same lexical family as
  // the excluded action word "select") does NOT count as actionable — it
  // is exactly as strong as a plain mention, i.e. not strong enough alone.
  const controlNames = (o.controls || []).map((c) => (typeof c === 'string' ? c : c.name) || '');
  const fieldNames = (o.fields || []).map((f) => `${f.label || ''} ${f.ariaLabel || ''} ${f.placeholder || ''} ${f.semantic || ''}`);

  const controlEvidence = controlNames
    .map((name) => {
      const toks = tokenize(name);
      const matchedConceptToks = new Set();
      for (const w of conceptWords) for (const t of toks) if (tokenMatches(w, t)) matchedConceptToks.add(t);
      if (!matchedConceptToks.size) return null;
      const actionable = toks.some((t) => !matchedConceptToks.has(t) && isVerbActionToken(t));
      return { name, actionable };
    })
    .filter(Boolean);

  const matchingControls = controlEvidence.map((c) => c.name);
  const actionableControlMatch = controlEvidence.some((c) => c.actionable);
  const matchingFields = fieldNames.filter((n) => {
    const toks = tokenize(n);
    return conceptWords.some((w) => toks.some((t) => tokenMatches(w, t)));
  });

  if (conceptWords.length && inHeading.length >= Math.ceil(conceptWords.length / 2)) { score += 3; signals.push(`heading matches "${inHeading.join(' ')}"`); }
  else if (inHeading.length) { score += 1; signals.push(`heading mentions "${inHeading.join(' ')}"`); }
  if (inUrl.length) { score += 1; signals.push(`url path mentions "${inUrl.join(' ')}"`); }
  if (conceptWords.length && inText.length >= Math.ceil(conceptWords.length / 2) && !inHeading.length) { score += 1; signals.push(`visible text mentions "${inText.join(' ')}"`); }
  if (actionableControlMatch) { score += 3; signals.push(`an actionable control matches the request: "${controlEvidence.find((c) => c.actionable).name}"`); }
  else if (matchingControls.length) { score += 2; signals.push(`a control on the page matches the request: "${matchingControls[0]}"`); }
  if (matchingFields.length) { score += 1; signals.push(`a form field matches the request: "${matchingFields[0].trim()}"`); }

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

  // ── ANTI-FALSE-POSITIVE GATE ─────────────────────────────────────────
  // "form" is the catch-all kind: pageKind() returns it for ANY page with 4+
  // fields, so a homepage carrying a booking widget looks like "form" — and a
  // feature label such as "Passenger Details" asks for "form". Score alone
  // then declares the homepage reached with zero navigation (observed live on
  // a live public homepage: 51 fields, no heading match, "reached").
  //
  // So a score is only allowed to mean REACHED when it rests on something
  // that actually identifies THIS experience:
  //   - the page's own kind is a SPECIFIC one (checkout, login, cart, ...), or
  //   - the feature's CONCEPT words appear in the headings or the URL path, or
  //   - a real control demonstrates COHERENT evidence, not one coincidental
  //     element (see below).
  //
  // Coherent structural evidence (Phase 7/8 hardening): ANY single control
  // that merely contains a concept word is NOT enough on its own — a
  // homepage footer link ("Baggage information"), an informational link
  // ("Learn about seat selection") or a marketing CTA ("Explore our meals")
  // each contain the requested word but prove nothing about a functional
  // feature being active. Structural identification therefore requires ONE
  // of:
  //   - a control that is independently actionable (concept word + a
  //     genuinely distinct action-verb token on the SAME control), or
  //   - at least two independent matching controls (a real option set —
  //     e.g. "Choose seat 14A" + "Choose seat 14B" — is categorically
  //     different from one passing mention), or
  //   - a matching control AND a matching form field together (workflow
  //     context, not a link).
  const lexicalMatch = inHeading.length > 0 || inUrl.length > 0;
  const specificKind = wantKinds.includes(kind) && SPECIFIC_KINDS.has(kind);
  const structuralMatch = actionableControlMatch || matchingControls.length >= 2 || (matchingControls.length >= 1 && matchingFields.length >= 1);
  const identified = lexicalMatch || specificKind || structuralMatch;
  const scoreReached = confidence === 'high' || confidence === 'medium';
  const reached = scoreReached && identified;
  if (scoreReached && !identified) {
    signals.push(`not accepted: only a generic "${kind}" page, or evidence too weak/incoherent — "${featureLabel}" does not appear in the headings, URL, or as coherent on-page control evidence`);
  }

  const verdict = reached ? 'match' : confidence === 'none' ? 'no-match' : 'ambiguous';
  if (verdict === 'ambiguous') {
    signals.push('ambiguous: some signal present but not enough for a confident deterministic decision — candidate for future AI semantic verification, not a deterministic accept');
  }

  return { reached, confidence, verdict, signals, kind, identified, lexicalMatch, structuralMatch };
}

function tinyHash(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Bounded, privacy-conscious signature of a single interactive field's
 * CURRENT state — used by pageStateFingerprint() so "empty" vs. "typed" vs.
 * "confirmed" are distinguishable even for custom trigger-style controls
 * (a button/pill showing "From SEA" rather than a real <input>.value, which
 * `hasValue` alone cannot see). Never stores or logs the field's actual
 * text: only a coarse length bucket + a one-way hash of it, so a real
 * change (typed, selected, cleared) changes the signature deterministically
 * without the raw content — even synthetic test values — ever appearing in
 * this string, in telemetry, or in logs.
 */
function fieldStateSignature(f, norm) {
  const shownText = norm(f.ariaLabel || f.label || '');
  const lenBucket = shownText.length === 0 ? 0 : shownText.length < 8 ? 1 : shownText.length < 24 ? 2 : 3;
  const valueSig = `${f.hasValue ? 'v' : ''}${lenBucket}${shownText ? tinyHash(shownText) : ''}`;
  const expanded = f.expanded === 'true' ? 'x1' : (f.expanded === 'false' ? 'x0' : '');
  const checked = f.checked === 'true' ? 'c1' : (f.checked === 'false' ? 'c0' : '');
  const selected = f.selected === 'true' ? 's1' : '';
  return `${valueSig}${expanded}${checked}${selected}`;
}

/**
 * Diagnostic-safe view of each field's contribution to the fingerprint —
 * the same bounded/hashed signature pageStateFingerprint() uses, exposed so
 * a watchdog trace can show WHICH field changed (or didn't) without ever
 * exposing the raw typed/selected text. Not part of the fingerprint hash
 * itself; a read-only debug aid.
 */
export function describeFieldStates(observation) {
  const o = observation || {};
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return (o.fields || []).map((f) => ({
    key: f.semantic || norm(f.label || f.name || f.placeholder) || null,
    sig: fieldStateSignature(f, norm),
  }));
}

/** Generic fingerprint of the page state — for the universal stuck detector. */
export function pageStateFingerprint(observation) {
  const o = observation || {};
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const parts = [
    norm(o.url),
    (o.headings || []).map(norm).sort().join('|'),
    (o.fields || []).map((f) => `${f.semantic || norm(f.label || f.name || f.placeholder)}:${fieldStateSignature(f, norm)}`).sort().join(','),
    (o.controls || o.buttons || []).map((c) => norm(typeof c === 'string' ? c : c.name)).sort().join(','),
    norm(o.bodyText).slice(0, 500),
    Object.entries(o.counts || {}).map(([k, v]) => `${k}=${v}`).sort().join(','),
  ];
  // small, order-independent digest
  const str = parts.join('§');
  return `${(o.url || '').split('?')[0]}#${tinyHash(str)}`;
}

// Exported for direct helper-level unit testing of the word-boundary
// matching strategy itself (Phase 1 audit / Phase 11 tests) — not used
// elsewhere in the codebase.
export { keyWords, tokenize, tokenMatches, verbMatches };
