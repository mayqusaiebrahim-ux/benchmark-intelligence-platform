/**
 * goal_navigator/actionSafety — every candidate action the goal navigator is
 * about to take is classified here FIRST. Nothing is clicked/typed until it
 * has a classification and the classification is in the allowed set.
 *
 * This mirrors navigation_runner/actions.js's denylist model, extended for a
 * multi-step booking flow: the navigator may progress through search → results
 * → fare → passenger details → ancillaries → seat → the payment PAGE, but must
 * stop before anything that spends money, issues a ticket, authenticates with
 * real credentials, or submits real PII.
 *
 * Classifications (spec §6):
 *   SAFE_NAVIGATION        continue / next / a link deeper into the flow
 *   SAFE_FORM_FILL         typing a synthetic value into a field
 *   SAFE_SELECTION         choosing a flight / fare / seat (no purchase)
 *   TARGET_REACHED         the requested feature detector fired
 *   IRREVERSIBLE_TRANSACTION  pay / confirm / purchase / issue ticket
 *   AUTH_REQUIRED          login / member sign-in / booking-reference lookup
 *   UNKNOWN_RISK           can't prove it's safe → do not proceed
 */

// Anything matching this is IRREVERSIBLE_TRANSACTION — never clicked.
const TRANSACTION_RE = new RegExp([
  'pay\\s*now', 'pay\\s+(?:sar|usd|aed|eur|gbp|\\$|€|£)', '\\bpay\\b(?!\\s*(?:later|pal))',
  'confirm\\s+(?:and\\s+)?(?:pay|book|booking|purchase|payment|order)',
  'complete\\s+(?:booking|purchase|payment|order|reservation)',
  'place\\s+order', 'submit\\s+payment', 'make\\s+payment', 'authorise\\s+payment', 'authorize\\s+payment',
  'purchase', 'buy\\s+now', 'checkout\\s+now', 'proceed\\s+to\\s+pay',
  'issue\\s+ticket', 'ticket\\s+now', 'finalize', 'finalise',
  'add\\s+card', 'save\\s+card', 'card\\s+number', 'cvv', 'cvc', 'security\\s+code',
  'redeem\\s+(?:miles|points|avios)', 'use\\s+(?:miles|points|avios)',
  'accept\\s+and\\s+pay', 'agree\\s+and\\s+pay',
].join('|'), 'i');

// Anything matching this is AUTH_REQUIRED — reported as blocked unless test
// credentials/booking refs are explicitly configured (they are not, today).
const AUTH_RE = new RegExp([
  'log\\s*in', 'sign\\s*in', 'signin', 'login',
  'member(?:ship)?\\s+(?:id|number|login)', 'frequent\\s+flyer\\s+login',
  'enter\\s+your\\s+password', '\\bpassword\\b', 'one[- ]time\\s+pass', '\\botp\\b',
  'booking\\s+reference', 'booking\\s+ref', 'pnr', 'retrieve\\s+(?:my\\s+)?booking',
  'last\\s+name\\s+and\\s+booking', 'e[- ]?ticket\\s+number',
  'create\\s+(?:an\\s+)?account', 'register\\s+now',
].join('|'), 'i');

// Safe forward-motion verbs (only used when NOTHING transactional/auth matched).
const CONTINUE_RE = /\b(continue|next|proceed|go\s+to\s+(?:passengers?|extras|seats?|payment|review)|review\s+(?:and\s+)?continue|save\s+and\s+continue|confirm\s+details|confirm\s+selection|to\s+payment|search(?:\s+flights?)?|find\s+flights?|show\s+flights?|view\s+flights?|see\s+flights?|update\s+search|skip|no\s+thanks|not\s+now|maybe\s+later|continue\s+without|no\s+thank\s+you|decline|not\s+interested)\b/i;
const SELECT_RE = /\b(select|choose|pick|add\s+to\s+(?:trip|booking)|book\s+this|this\s+flight|this\s+fare|economy|business|first\s+class|fare\s+lock|select\s+seat|choose\s+seat)\b/i;

/**
 * classifyAction — the single gate.
 * @param {object} action
 * @param {'click'|'fill'|'select'|'observe'} action.kind
 * @param {string} [action.name]   accessible name / label / button text
 * @param {string} [action.fieldSemantic]  for fill/select — the resolved field meaning
 * @param {boolean} [action.targetDetected]  a feature detector already fired on the page
 * @returns {{ classification: string, allowed: boolean, reason: string }}
 */
export function classifyAction(action = {}) {
  const name = String(action.name || '').trim();
  const kind = action.kind || 'click';

  if (action.targetDetected) {
    return { classification: 'TARGET_REACHED', allowed: false, reason: 'the requested feature is on screen — capture and stop' };
  }

  // Transaction / auth checks apply to ALL kinds (a field called "Card number"
  // is just as forbidden as a button called "Pay now").
  if (TRANSACTION_RE.test(name) || (action.fieldSemantic && /^(card_number|card_cvv|card_expiry|card_name)$/.test(action.fieldSemantic))) {
    return { classification: 'IRREVERSIBLE_TRANSACTION', allowed: false, reason: `"${name || action.fieldSemantic}" would spend money / finalise a purchase` };
  }
  if (AUTH_RE.test(name) || (action.fieldSemantic && /^(password|booking_reference|member_id)$/.test(action.fieldSemantic))) {
    return { classification: 'AUTH_REQUIRED', allowed: false, reason: `"${name || action.fieldSemantic}" needs real credentials or a booking reference` };
  }

  if (kind === 'observe') {
    return { classification: 'SAFE_NAVIGATION', allowed: true, reason: 'observing the current page' };
  }
  if (kind === 'fill') {
    return { classification: 'SAFE_FORM_FILL', allowed: true, reason: `fill "${action.fieldSemantic || name}" with a synthetic value` };
  }
  if (kind === 'select') {
    return { classification: 'SAFE_SELECTION', allowed: true, reason: `select "${name || action.fieldSemantic}"` };
  }

  // kind === 'click'
  if (SELECT_RE.test(name)) {
    return { classification: 'SAFE_SELECTION', allowed: true, reason: `"${name}" selects an option without purchasing` };
  }
  if (CONTINUE_RE.test(name)) {
    return { classification: 'SAFE_NAVIGATION', allowed: true, reason: `"${name}" advances one step in the flow` };
  }

  // Couldn't prove it's safe.
  return { classification: 'UNKNOWN_RISK', allowed: false, reason: `"${name}" could not be classified as a known-safe action` };
}

export const SAFETY = {
  TRANSACTION_RE, AUTH_RE, CONTINUE_RE, SELECT_RE,
};
