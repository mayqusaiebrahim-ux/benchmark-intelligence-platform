/**
 * companyUrls — a small, explicit, hand-curated company → official homepage
 * URL table. Used only to fill in a URL when a benchmark request was created
 * without one (e.g. the wizard's quick-add competitor chips, which produce
 * { name, url: null }).
 *
 * Deliberately NOT sourced from previous benchmark data / the Master Matrix:
 * the correctness spec forbids reusing another run's URL unless the company
 * identity is explicitly validated, and a curated map keyed by a normalised
 * slug IS that explicit validation. If a company is not in this table and
 * the request carried no URL, resolution returns null and the Feature
 * Benchmark fails before any browser work (see benchmarkTarget.js /
 * featurePipeline.js) — it never guesses.
 */

function normSlug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// slug -> official https homepage. Keep entries minimal and verifiable.
export const KNOWN_COMPANY_URLS = {
  // Airlines
  qatar_airways: 'https://www.qatarairways.com/',
  emirates: 'https://www.emirates.com/',
  etihad_airways: 'https://www.etihad.com/',
  etihad: 'https://www.etihad.com/',
  turkish_airlines: 'https://www.turkishairlines.com/',
  singapore_airlines: 'https://www.singaporeair.com/',
  lufthansa: 'https://www.lufthansa.com/',
  air_france: 'https://www.airfrance.com/',
  klm: 'https://www.klm.com/',
  delta_air_lines: 'https://www.delta.com/',
  delta: 'https://www.delta.com/',
  united_airlines: 'https://www.united.com/',
  american_airlines: 'https://www.aa.com/',
  british_airways: 'https://www.britishairways.com/',
  alaska_airlines: 'https://www.alaskaair.com/',
  airasia: 'https://www.airasia.com/',
  saudia: 'https://www.saudia.com/',
  ryanair: 'https://www.ryanair.com/',
  jetblue: 'https://www.jetblue.com/',

  // OTAs / metasearch
  booking_com: 'https://www.booking.com/',
  expedia: 'https://www.expedia.com/',
  trip_com: 'https://www.trip.com/',
  ixigo: 'https://www.ixigo.com/',
  kayak: 'https://www.kayak.com/',
  skyscanner: 'https://www.skyscanner.net/',
  agoda: 'https://www.agoda.com/',
  hopper: 'https://www.hopper.com/',
  almosafer: 'https://www.almosafer.com/',
  wego: 'https://www.wego.com/',
  airbnb: 'https://www.airbnb.com/',

  // AI-first travel products
  mindtrip: 'https://mindtrip.ai/',
  layla: 'https://www.layla.ai/',
  roam_around: 'https://www.roamaround.io/',
  wonderplan: 'https://wonderplan.ai/',
  google_travel: 'https://www.google.com/travel/',
};

/**
 * @param {string} nameOrSlug  a company display name or an existing slug
 * @returns {string|null} the curated official URL, or null if not known
 */
export function resolveOfficialUrl(nameOrSlug) {
  if (!nameOrSlug) return null;
  const slug = normSlug(nameOrSlug);
  return KNOWN_COMPANY_URLS[slug] || null;
}

export function isKnownCompany(nameOrSlug) {
  return resolveOfficialUrl(nameOrSlug) != null;
}
