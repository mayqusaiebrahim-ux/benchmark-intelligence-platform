/**
 * Discovery — safe action execution.
 * The only file that clicks anything, and it clicks at most two things per run:
 * a consent-banner accept control, and a collapsed nav-menu toggle. Both targets
 * are located by accessible name/role discovered live on THIS page by signals.js
 * — never a selector authored ahead of time for a known vendor. Every candidate
 * is re-checked against a transactional denylist immediately before clicking, as
 * a second line of defense.
 *
 * Nothing else is ever clicked: no search, no forms, no login, no booking, no
 * checkout, no payment, no passenger data.
 */

const TRANSACTIONAL_DENYLIST = new RegExp(
  [
    'search flights?', 'find flights?', 'book(\\s+now)?', 'checkout', 'sign\\s*in', 'log\\s*in',
    'register', 'create account', 'buy', 'pay(\\s|$)', 'purchase', 'reserve',
    'confirm( and)? (pay|book)', 'add to cart', 'passenger', 'continue to payment',
  ].join('|'),
  'i'
);

function isSafe(name) {
  return !!name && !TRANSACTIONAL_DENYLIST.test(name);
}

async function locateByAccessibleName(page, name) {
  for (const role of ['button', 'link']) {
    const locator = page.getByRole(role, { name, exact: true });
    if ((await locator.count()) > 0) return locator.first();
  }
  const textLocator = page.getByText(name, { exact: true });
  if ((await textLocator.count()) > 0) return textLocator.first();
  return null;
}

/**
 * dismissConsentBanner — clicks an "Accept"-style control inside a detected
 * consent banner, only if one was found and its label clears the denylist.
 */
export async function dismissConsentBanner(page, consentCandidate) {
  if (!consentCandidate || !consentCandidate.acceptCandidates?.length) return null;

  const target = consentCandidate.acceptCandidates.find(c => isSafe(c.name));
  if (!target) return null;

  try {
    const locator = await locateByAccessibleName(page, target.name);
    if (!locator) return null;
    await locator.click({ timeout: 3000 });
    return { action: 'dismiss_consent_banner', evidence: target.name };
  } catch {
    return null; // Never let a failed safe-click break discovery — just report nothing happened.
  }
}

/**
 * expandNavigationMenu — clicks a nav toggle only when it looks collapsed
 * (aria-expanded="false", or no ARIA state at all combined with very few
 * visible nav links so far), and only if its label clears the denylist.
 */
export async function expandNavigationMenu(page, navToggleCandidate, currentNavLinkCount) {
  if (!navToggleCandidate) return null;

  const looksCollapsed =
    navToggleCandidate.ariaExpanded === false ||
    (navToggleCandidate.ariaExpanded === null && currentNavLinkCount <= 1);
  if (!looksCollapsed || !isSafe(navToggleCandidate.name)) return null;

  try {
    const locator = await locateByAccessibleName(page, navToggleCandidate.name);
    if (!locator) return null;
    await locator.click({ timeout: 3000 });
    return { action: 'expand_navigation_menu', evidence: navToggleCandidate.name };
  } catch {
    return null;
  }
}
