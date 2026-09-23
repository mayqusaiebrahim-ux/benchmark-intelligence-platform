/**
 * goal_navigator/featureDetectors — "have we actually arrived at the requested
 * feature?" Navigation success is NOT "the previous click worked" (spec §4);
 * it is a positive detector match on the current page.
 *
 * Each detector takes an `observation` snapshot (produced by the page adapter)
 * and returns { matched, confidence, signals[] }. The navigator only marks the
 * target reached when confidence is 'medium' or 'high'.
 *
 * observation shape (all text lowercased, whitespace-collapsed):
 *   {
 *     url:        string,
 *     headings:   string[],           // h1..h3 / [role=heading]
 *     bodyText:   string,             // concatenated visible text
 *     buttons:    string[],           // clickable accessible names
 *     fields:     [{ semantic, label, type }],  // resolved form fields on screen
 *     counts:     { flightCards, fareCards, seatCells, priceTags }
 *   }
 */

const has = (arr, re) => (arr || []).some((s) => re.test(s));
const txt = (o, re) => re.test(o.bodyText || '');
const field = (o, sem) => (o.fields || []).some((f) => f.semantic === sem);
const count = (o, k) => Number(o.counts?.[k] || 0);

function result(matched, confidence, signals) {
  return { matched: !!matched, confidence: matched ? confidence : 'none', signals };
}

export const FEATURE_DETECTORS = {
  flight_results(o) {
    const s = [];
    if (count(o, 'flightCards') >= 2) s.push(`${count(o, 'flightCards')} flight cards`);
    if (txt(o, /\b\d{1,2}:\d{2}\s*(am|pm)?\b.*\b\d{1,2}:\d{2}\s*(am|pm)?\b/)) s.push('departure/arrival times');
    if (count(o, 'priceTags') >= 2) s.push('multiple fare prices');
    if (has(o.headings, /(select (your )?flight|choose (your )?flight|available flights|flight results|outbound flight)/)) s.push('results heading');
    if (txt(o, /\b(non-?stop|direct|1 stop|layover|duration)\b/)) s.push('stops/duration text');
    const strong = s.length >= 2 && (count(o, 'flightCards') >= 2 || has(o.headings, /flight/));
    return result(s.length >= 1, strong ? 'high' : (s.length >= 2 ? 'medium' : 'low'), s);
  },

  fare_selection(o) {
    const s = [];
    if (count(o, 'fareCards') >= 2) s.push(`${count(o, 'fareCards')} fare cards`);
    if (txt(o, /\b(economy (lite|classic|flex|saver|value)|business (lite|flex|saver)|fare family|fare type|light|classic|flex)\b/)) s.push('fare-family names');
    if (has(o.headings, /(select (your )?fare|choose (your )?fare|fare options|select cabin|which fare)/)) s.push('fare heading');
    if (txt(o, /\b(refundable|changeable|checked bag(gage)? included|seat selection included|no changes)\b/)) s.push('fare-rule comparison');
    const strong = count(o, 'fareCards') >= 2 && s.length >= 2;
    return result(s.length >= 2, strong ? 'high' : 'medium', s);
  },

  // Multi-signal, airline-agnostic. Proven live (real Alaska Airlines
  // /book/guest-info page) that per-field semantic tags alone are NOT
  // reliable evidence: a site can render name/DOB fields with a label
  // association the extraction layer can't resolve (e.g. a floating/slotted
  // label inside a shadow-DOM component), so first_name/last_name/
  // date_of_birth can all read as absent even though the fields are
  // genuinely on screen. This detector therefore treats exact field
  // semantics as a BONUS signal, not a requirement — heading phrasing,
  // instructional/contextual text, and a generic "substantial form on an
  // active booking page" count all combine, matching how a human would
  // recognize the page even without perfect field labeling.
  passenger_details(o) {
    const s = [];
    const hasFirst = field(o, 'first_name');
    const hasLast = field(o, 'last_name');
    const hasBothNames = hasFirst && hasLast;
    const hasDob = field(o, 'date_of_birth');
    const hasTitleOrGender = field(o, 'title') || field(o, 'gender');
    if (hasBothNames) s.push('first + last name fields');
    else if (hasFirst || hasLast) s.push('a name field');
    if (hasDob) s.push('date-of-birth field');
    if (hasTitleOrGender) s.push('title/gender field');

    // Covers "Passenger/Traveller/Traveler/Guest [Details/Information]",
    // "Primary Contact/Traveler/Passenger/Guest", "Who's travelling",
    // "Contact details" — generic wording across carriers, not one string.
    // "passenger"/"traveler"/"traveller" alone are specific enough to count
    // as a heading signal (e.g. "Passenger 1", "Traveler Details"). "guest"
    // is NOT — it's common travel-marketing copy unrelated to this feature
    // (proven by a real fixture: Etihad's own homepage tagline "life's
    // better as a guest") — so "guest" only counts when qualified by
    // "information"/"details" or "primary guest".
    const headingMatch = has(o.headings, /\b(passengers?|travell?ers?)\b|(guests?)\s*(information|details)\b|who('| i)s travel|primary (contact|travell?er|passenger|guest)|contact details/i);
    if (headingMatch) s.push('traveler/passenger heading');

    const govIdText = txt(o, /\b(government[- ]?issued (photo )?id|as it appears on (your|the traveler'?s?|the traveller'?s?) (passport|id|photo ?id))\b/i);
    if (govIdText) s.push('government-ID instruction text');

    const tsaText = txt(o, /\b(tsa\s*pre.?check|known traveler( number)?|known traveller( number)?|redress number)\b/i);
    if (tsaText) s.push('TSA PreCheck / known-traveler text');

    const loyaltyText = txt(o, /\b(loyalty (program|number)|frequent flyer( number)?|membership number)\b/i);
    if (loyaltyText) s.push('loyalty/frequent-flyer text');

    // Structural fallback for when per-field semantics don't resolve: a
    // substantial number of visible fields on the page. Deliberately a
    // HIGHER bar than genericVerify's generic "4+ fields" form heuristic —
    // this is evidence of a real, LARGE traveler-info form, not just any
    // form, and is only ever used ALONGSIDE a heading or contextual signal
    // below, never alone.
    const visibleFieldCount = (o.fields || []).filter((f) => f.visible !== false).length;
    const substantialForm = visibleFieldCount >= 5;
    if (substantialForm) s.push(`${visibleFieldCount} visible fields`);

    // Never match a login or payment surface, even if wording coincidentally
    // overlaps (e.g. a payment page also mentions "contact details").
    const looksLikeLogin = field(o, 'password') || has(o.headings, /\b(sign in|log in|login)\b/i);
    const looksLikePayment = txt(o, /\b(card number|cvv|cvc|expir(y|ation) date)\b/i) && !hasBothNames;
    if (looksLikeLogin || looksLikePayment) return result(false, 'none', s);

    const contextSignals = [govIdText, tsaText, loyaltyText].filter(Boolean).length;

    // STRONG: real name+DOB fields, or names plus a heading/traveler context.
    const strong = hasBothNames && (hasDob || headingMatch);
    // MEDIUM: a traveler/passenger heading corroborated by SOME other
    // evidence (a name field, a substantial form, or contextual text) — a
    // heading alone, or one isolated field alone, is never enough.
    const medium = hasBothNames
      || (headingMatch && (hasFirst || hasLast || substantialForm || contextSignals >= 1))
      || (contextSignals >= 2 && substantialForm);

    return result(strong || medium, strong ? 'high' : 'medium', s);
  },

  seat_selection(o) {
    const s = [];
    if (count(o, 'seatCells') >= 12) s.push(`${count(o, 'seatCells')} seat cells`);
    if (has(o.headings, /(seat (map|selection|assignment)|choose (your )?seat|select (your )?seat|where would you like to sit)/)) s.push('seat heading');
    if (txt(o, /\b(window|aisle|middle|exit row|extra legroom|seat \d{1,2}[a-k]\b)/)) s.push('seat-attribute text');
    if (txt(o, /\b(front of (the )?cabin|rear of (the )?cabin|deck|aircraft (layout|map))\b/)) s.push('cabin layout text');
    const strong = count(o, 'seatCells') >= 12 || (has(o.headings, /seat/) && s.length >= 2);
    return result(s.length >= 1 && (has(o.headings, /seat/) || count(o, 'seatCells') >= 12), strong ? 'high' : 'medium', s);
  },

  ancillaries(o) {
    const s = [];
    if (has(o.headings, /(extras|add[- ]ons|optional (extras|services)|enhance your (trip|flight)|baggage|meals?|extra baggage)/)) s.push('extras heading');
    if (txt(o, /\b(extra baggage|additional baggage|pre[- ]?order (a )?meal|lounge access|travel insurance|priority boarding|carbon offset)\b/)) s.push('ancillary catalogue text');
    if (has(o.buttons, /\b(add|skip|no thanks|continue without)\b/)) s.push('add/skip controls');
    const strong = has(o.headings, /extras|add[- ]ons|baggage|meals?/) && s.length >= 2;
    return result(s.length >= 2, strong ? 'high' : 'medium', s);
  },

  payment(o) {
    const s = [];
    if (has(o.headings, /(payment|how would you like to pay|select (a )?payment (method|option)|billing)/)) s.push('payment heading');
    if (txt(o, /\b(credit\/debit card|pay with card|apple pay|google pay|paypal|tabby|tamara|bnpl|instal?ments|voucher|gift card|miles \+ cash)\b/)) s.push('payment-method list');
    if (txt(o, /\b(total (to pay|amount|due)|amount payable|price breakdown|fare summary)\b/)) s.push('payment summary');
    if ((o.fields || []).some((f) => /^card_/.test(f.semantic))) s.push('card fields present (STOP — not filled)');
    const strong = has(o.headings, /payment|billing/) && s.length >= 2;
    return result(s.length >= 2 || has(o.headings, /payment/), strong ? 'high' : 'medium', s);
  },

  checkin(o) {
    const s = [];
    if (has(o.headings, /(check[- ]?in|online check[- ]?in|boarding pass)/)) s.push('check-in heading');
    if (field(o, 'booking_reference')) s.push('booking-reference field (AUTH — not filled)');
    if (field(o, 'last_name') && txt(o, /booking reference|pnr|e[- ]?ticket/)) s.push('last-name + reference lookup');
    return result(has(o.headings, /check[- ]?in/) || field(o, 'booking_reference'), 'medium', s);
  },

  manage_booking(o) {
    const s = [];
    if (has(o.headings, /(manage (my )?booking|my trips?|retrieve (your )?booking|trip (overview|management)|find (my )?booking)/)) s.push('manage-booking heading');
    if (field(o, 'booking_reference')) s.push('booking-reference field (AUTH — not filled)');
    return result(has(o.headings, /manage (my )?booking|my trips?|retrieve/) || field(o, 'booking_reference'), 'medium', s);
  },

  signin(o) {
    const s = [];
    if (field(o, 'password')) s.push('password field (AUTH — not filled)');
    if (has(o.headings, /(sign in|log in|member login|welcome back|account login)/)) s.push('sign-in heading');
    if (field(o, 'email') && field(o, 'password')) s.push('email + password pair');
    if (txt(o, /\b(member(ship)? id|forgot (your )?password|remember me|stay signed in)\b/)) s.push('login helper text');
    return result(field(o, 'password') || has(o.headings, /sign in|log in|member login/), field(o, 'password') ? 'high' : 'medium', s);
  },

  loyalty(o) {
    const s = [];
    if (has(o.headings, /(privilege club|skywards|alfursan|miles ?&? ?more|frequent flyer|loyalty (programme|program)|earn (miles|points)|tier (benefits|status))/)) s.push('loyalty-programme heading');
    if (txt(o, /\b(earn and spend miles|tier (miles|points)|silver|gold|platinum member|redeem (miles|points))\b/)) s.push('tier/redemption text');
    return result(s.length >= 1, s.length >= 2 ? 'high' : 'medium', s);
  },

  flight_search(o) {
    const s = [];
    if (field(o, 'origin') || field(o, 'destination')) s.push('origin/destination fields');
    if (has(o.buttons, /\b(search|find flights?|show flights?|explore)\b/)) s.push('search button');
    if (has(o.headings, /(book (a )?flight|search flights?|plan (your )?trip|where (to|would you like to go))/)) s.push('search heading');
    return result((field(o, 'origin') && field(o, 'destination')) || (s.length >= 2), s.length >= 2 ? 'high' : 'medium', s);
  },
};

// Feature keyword / journey-step → detector key.
export const DETECTOR_FOR_STEP = {
  step_03_search: 'flight_search',
  step_07_booking: 'passenger_details',
  step_08_ancillaries: 'ancillaries',
  step_09_payment: 'payment',
  step_10_trip_management: 'manage_booking',
  step_11_checkin: 'checkin',
  step_12_loyalty: 'loyalty',
};

/**
 * detectFeature — run one named detector (or, if unknown, return no-match).
 * `minConfidence` gates what counts as "reached".
 */
export function detectFeature(detectorKey, observation, { minConfidence = 'medium' } = {}) {
  const fn = FEATURE_DETECTORS[detectorKey];
  if (!fn) return { matched: false, confidence: 'none', signals: [], detectorKey, known: false, reached: false };
  const r = fn(observation || {});
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  const reached = r.matched && rank[r.confidence] >= rank[minConfidence];
  return { ...r, detectorKey, known: true, reached };
}

/**
 * anyStrongerFeature — if the page clearly shows a LATER feature than the one
 * we were told to stop at (e.g. we aimed for Fare Selection but landed on
 * Payment), report it so the navigator can stop honestly instead of acting.
 */
export function scanAllDetectors(observation) {
  const hits = [];
  for (const key of Object.keys(FEATURE_DETECTORS)) {
    const r = FEATURE_DETECTORS[key](observation || {});
    if (r.matched && (r.confidence === 'medium' || r.confidence === 'high')) hits.push({ key, ...r });
  }
  return hits;
}
