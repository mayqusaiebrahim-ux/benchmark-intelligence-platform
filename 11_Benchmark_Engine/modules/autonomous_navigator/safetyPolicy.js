/**
 * autonomous_navigator/safetyPolicy — DETERMINISTIC, code-enforced safety.
 * The agent prompt asks nicely; this layer makes it structurally impossible to
 * complete a transaction, authenticate, or submit payment/personal credentials.
 *
 * Two independent mechanisms:
 *   1. SAFETY_INIT_SCRIPT — injected into every page/frame BEFORE its scripts.
 *      Capture-phase listeners cancel clicks/submits on transaction & auth
 *      controls; card/password inputs are forced read-only; form.submit() /
 *      requestSubmit() on any form holding a card or password field is blocked.
 *      Every block is recorded on window.__benchSafety.blocks.
 *   2. safetyProbe(observation) — a Node-side check after each watchdog tick:
 *      if the page is a transaction-imminent / auth-wall state that isn't the
 *      requested target, the run is aborted before the agent can act on it.
 */
import { SAFETY } from '../goal_navigator/actionSafety.js';

// Reuse the exact transaction / auth regex sources the heuristic navigator uses
// (single source of truth), recompiled for the browser context as strings.
const TX_SRC = SAFETY.TRANSACTION_RE.source;
const AUTH_SRC = SAFETY.AUTH_RE.source;

export const SAFETY_INIT_SCRIPT = `
(() => {
  if (window.__benchSafety) return;
  var TX = new RegExp(${JSON.stringify(TX_SRC)}, 'i');
  var AUTH = new RegExp(${JSON.stringify(AUTH_SRC)}, 'i');
  window.__benchSafety = { blocks: [], installedAt: Date.now() };
  function record(why){ try { window.__benchSafety.blocks.push({ why: String(why).slice(0,120), at: location.href, t: Date.now() }); } catch(e){} }
  function nameOf(el){
    try {
      return ((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || el.textContent || el.value || (el.getAttribute && el.getAttribute('title')) || '').replace(/\\s+/g,' ').trim().slice(0,120);
    } catch(e){ return ''; }
  }
  function isCardOrSecret(el){
    try {
      if (!el || !el.matches) return false;
      return el.matches('input[type="password" i], input[autocomplete*="cc-" i], input[name*="card" i], input[name*="cardnumber" i], input[name*="cvv" i], input[name*="cvc" i], input[name*="cvn" i], input[name*="securitycode" i], input[id*="card" i], input[id*="cvv" i], input[aria-label*="card number" i], input[aria-label*="security code" i], input[aria-label*="cvv" i]');
    } catch(e){ return false; }
  }
  function cancel(ev, why){
    record(why);
    try { ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); } catch(e){}
    return false;
  }
  var INTERACTIVE = { BUTTON:1, A:1, INPUT:1, SUMMARY:1, LABEL:1 };
  function guard(ev){
    try {
      var path = ev.composedPath ? ev.composedPath() : [ev.target];
      // Only inspect the actual target + its nearest interactive ancestor(s) —
      // NOT body/html/document (whose text contains the whole page).
      var checked = 0;
      for (var i = 0; i < path.length && checked < 4; i++){
        var el = path[i];
        if (!el || el.nodeType !== 1) continue;
        var tag = el.tagName;
        if (tag === 'BODY' || tag === 'HTML' || tag === 'FORM' || tag === 'MAIN' || tag === 'NAV') break;
        var role = el.getAttribute && el.getAttribute('role');
        var isInteractive = INTERACTIVE[tag] || role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem';
        if (!isInteractive && checked > 0) continue;
        checked++;
        var n = nameOf(el);
        if (!n || n.length > 60) continue;               // a long name = a container, not a control
        if (TX.test(n)) return cancel(ev, 'transaction control: ' + n);
        if (AUTH.test(n) && ev.type !== 'pointerdown') return cancel(ev, 'auth control: ' + n);
      }
    } catch(e){}
  }
  ['click','submit','pointerup','keydown'].forEach(function(t){
    try { window.addEventListener(t, function(ev){
      if (t === 'keydown' && ev.key !== 'Enter') return;
      guard(ev);
    }, true); } catch(e){}
  });
  var CARD_SEL = 'input[type=password i],input[autocomplete*="cc-" i],input[name*="card" i],input[name*="cardnumber" i],input[name*="cvv" i],input[name*="cvc" i],input[id*="cardnumber" i],input[id*="cvv" i],input[aria-label*="card number" i],input[aria-label*="cvv" i],input[aria-label*="security code" i]';
  function neuter(root){
    try {
      var list;
      try { list = (root || document).querySelectorAll(CARD_SEL); }
      catch(e){ list = (root || document).querySelectorAll('input[type=password]'); }
      for (var i = 0; i < list.length; i++){
        var inp = list[i];
        if (inp.getAttribute('data-bench-locked')) continue;
        try { inp.readOnly = true; inp.setAttribute('data-bench-locked','1'); inp.setAttribute('aria-disabled','true'); } catch(e){}
      }
    } catch(e){}
  }
  try {
    var mo = new MutationObserver(function(){ neuter(); });
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e){}
  neuter();
  try {
    document.addEventListener('DOMContentLoaded', function(){ neuter(); }, true);
    window.addEventListener('load', function(){ neuter(); }, true);
    document.addEventListener('focusin', function(ev){ if (ev.target && ev.target.matches && ev.target.matches(CARD_SEL)) neuter(); }, true);
  } catch(e){}
  function formHasSecret(form){ try { return !!form.querySelector('input[type="password" i], input[autocomplete*="cc-" i], input[name*="card" i], input[name*="cvv" i]'); } catch(e){ return false; } }
  try {
    var _submit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function(){ if (formHasSecret(this)) { record('form.submit() blocked (card/password form)'); return; } return _submit.apply(this, arguments); };
    if (HTMLFormElement.prototype.requestSubmit) {
      var _rs = HTMLFormElement.prototype.requestSubmit;
      HTMLFormElement.prototype.requestSubmit = function(){ if (formHasSecret(this)) { record('form.requestSubmit() blocked (card/password form)'); return; } return _rs.apply(this, arguments); };
    }
  } catch(e){}
})();
`;

/** Read (and clear) the DOM-side safety blocks recorded since the last read. */
export async function drainDomSafetyBlocks(page) {
  try {
    return await page.evaluate(() => {
      const w = window;
      if (!w.__benchSafety) return [];
      const b = w.__benchSafety.blocks.slice();
      w.__benchSafety.blocks.length = 0;
      return b;
    });
  } catch {
    return [];
  }
}

const PAYMENT_DETECTORS = new Set(['payment']);

/**
 * safetyProbe — is the CURRENT page a state we must not let the agent act in?
 * `observation` is a normalizeObservation() result; `targetKey` is the requested
 * detector. Returns { violation:boolean, reason?:string }.
 */
export function safetyProbe(observation, targetKey) {
  const o = observation || {};
  const fields = o.fields || [];
  const controls = o.controls || (o.buttons || []).map((n) => ({ name: n, context: 'other' }));
  const body = o.bodyText || '';

  const hasCardField = fields.some((f) => /^card_/.test(f.semantic || ''));
  const hasPasswordField = fields.some((f) => f.semantic === 'password');
  const hasPayButton = controls.some((c) => SAFETY.TRANSACTION_RE.test(c.name || ''));
  const hasOtpCopy = /\b(one[- ]time (code|password|pin)|verification code|enter the code we sent|otp)\b/i.test(body);

  // A card field + a Pay button, when the target is NOT the payment page,
  // means the agent has gone past the safe line.
  if (hasCardField && hasPayButton && !PAYMENT_DETECTORS.has(targetKey)) {
    return { violation: true, reason: 'card fields + a payment-submit control are present and the target is not the payment page' };
  }
  // For a payment-page target: card fields present is FINE (that's the target),
  // but a bank/3-D-Secure OTP challenge is never allowed.
  if (hasOtpCopy) {
    return { violation: true, reason: 'a one-time-code / OTP challenge is on screen' };
  }
  // A dedicated sign-in wall (password field + no booking form to fall back on)
  // when the target isn't sign-in.
  if (hasPasswordField && targetKey !== 'signin') {
    const bookingUsable = fields.some((f) => f.semantic === 'origin' || f.semantic === 'destination')
      || fields.some((f) => /^(first_name|last_name)$/.test(f.semantic || ''))
      || controls.some((c) => /\b(continue|next|search|proceed)\b/i.test(c.name || ''));
    const authSurface = fields.some((f) => f.semantic === 'password' && (f.context === 'auth' || f.context === 'modal'));
    if (authSurface && !bookingUsable) {
      return { violation: true, reason: 'a sign-in wall is blocking the journey and the target is not sign-in' };
    }
  }
  return { violation: false };
}
