/**
 * autonomous_navigator/semanticHandoff — deterministic, local-only contract
 * for whether an observation is eligible to be sent to a FUTURE AI semantic
 * verifier, and a cache key/contract to keep the same target + unchanged
 * page state from being sent twice.
 *
 * This module makes NO network/API calls, imports nothing external, and is
 * not wired into targetVerifier.js or autonomousNavigator.js yet — those
 * still only ever set `targetReached` from the deterministic
 * `genericVerify()` / `detectFeature()` results (see targetVerifier.js's
 * runGeneric() comment for the exact, still-unimplemented insertion point).
 * This file exists so the ELIGIBILITY DECISION and the "don't ask twice"
 * CACHE KEY are specified and tested before any paid integration exists,
 * rather than being decided ad hoc later inside runtime code.
 */

/**
 * Should this observation be eligible for the future AI semantic verifier?
 * Only the 'ambiguous' bucket ever is — a specialized-detector or generic
 * 'match' is already fully decided (ACCEPT), and a generic 'no-match' is
 * already fully decided (continue navigating; no signal exists to ask an AI
 * about). Calling the future verifier on every watchdog tick would be both
 * wasteful and pointless outside this one bucket.
 *
 * @param {{reached: boolean, verdict: 'match'|'no-match'|'ambiguous'}} genericResult
 *   the result of genericVerifier.genericVerify()
 * @param {{ specializedMatched?: boolean }} [opts]
 *   specializedMatched: true if a known featureDetectors key already
 *   produced a confident match — the generic result is then irrelevant,
 *   this target is already ACCEPTED, never send it to the AI layer.
 * @returns {boolean}
 */
export function shouldUseSemanticVerifier(genericResult, opts = {}) {
  const g = genericResult || {};
  if (opts.specializedMatched) return false;
  if (g.reached) return false;
  return g.verdict === 'ambiguous';
}

/**
 * Stable cache key from target identity (company + feature label, or any
 * caller-chosen identity string) + the page-state fingerprint
 * (genericVerifier.pageStateFingerprint()). Deliberately contains nothing
 * time-based: identical inputs always produce the identical key, so the
 * SAME target observed at the SAME unchanged page state always maps to the
 * same cache entry.
 */
export function semanticCacheKey(targetIdentity, fingerprint) {
  return `${String(targetIdentity || '')}::${String(fingerprint || '')}`;
}

/**
 * Minimal Set-backed "have we already asked the future AI verifier about
 * this exact target+page-state?" cache. No TTL, no external storage, no API
 * calls — a local contract only. A real integration would call
 * `isEligible()` on each watchdog tick BEFORE calling the AI verifier, and
 * `markChecked()` right after the (future) call returns, regardless of its
 * answer — so an already-answered ambiguous state is never re-asked while
 * the page has not changed.
 */
export function makeSemanticVerificationCache() {
  const seen = new Set();
  return {
    hasBeenChecked(targetIdentity, fingerprint) {
      return seen.has(semanticCacheKey(targetIdentity, fingerprint));
    },
    markChecked(targetIdentity, fingerprint) {
      seen.add(semanticCacheKey(targetIdentity, fingerprint));
    },
    isEligible(genericResult, targetIdentity, fingerprint, opts = {}) {
      if (!shouldUseSemanticVerifier(genericResult, opts)) return false;
      return !this.hasBeenChecked(targetIdentity, fingerprint);
    },
    size() { return seen.size; },
  };
}
