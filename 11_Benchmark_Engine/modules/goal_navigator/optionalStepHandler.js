/**
 * goal_navigator/optionalStepHandler — when the requested feature is deeper in
 * the flow than the current page, prefer skipping optional extras (seat, bags,
 * meals, insurance up-sells) rather than adding paid ancillaries (spec §8).
 */

const SKIP_RE = /^(?:\s*)(skip( for now| this step| seat selection| ancillaries)?|no thanks|no,? thanks|not now|maybe later|continue without( adding)?( extras| seats?| a seat| bags?)?|decline|not interested|i'?ll do this later|no,? i don'?t want)(?:\s*)$/i;

const ADD_PAID_RE = /\b(add (to (trip|booking|cart))?|upgrade( now)?|select (this )?(extra|meal|bag|insurance)|buy|purchase|include)\b/i;

/** Is this control an "opt out / skip" affordance? */
export function isOptionalSkip(name) {
  return SKIP_RE.test(String(name || '').trim());
}

/** Is this control adding a paid extra (which we should NOT click)? */
export function isPaidAddon(name) {
  return ADD_PAID_RE.test(String(name || '').trim());
}

/**
 * chooseOptionalControl — from the clickable names on an ancillary/extras
 * interstitial, return the best "keep moving" control:
 *   { name, action: 'skip' }         a real skip/decline button
 *   { name, action: 'continue' }     a plain Continue/Next (no add)
 *   null                             nothing safe — let the main loop decide
 * Never returns a paid "Add" control.
 */
export function chooseOptionalControl(buttons = []) {
  const names = buttons.map((b) => String(b || '').trim()).filter(Boolean);

  const skip = names.find(isOptionalSkip);
  if (skip) return { name: skip, action: 'skip' };

  const cont = names.find((n) => /^(continue|next|proceed)\b/i.test(n) && !isPaidAddon(n));
  if (cont) return { name: cont, action: 'continue' };

  return null;
}
