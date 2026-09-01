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

  passenger_details(o) {
    const s = [];
    if (field(o, 'first_name')) s.push('first name field');
    if (field(o, 'last_name')) s.push('last name field');
    if (field(o, 'date_of_birth')) s.push('date-of-birth field');
    if (field(o, 'title')) s.push('title selector');
    if (has(o.headings, /(passenger|traveller|traveler|guest|who('| i)s travel|contact details)/)) s.push('passenger heading');
    const strong = field(o, 'first_name') && field(o, 'last_name') && (field(o, 'date_of_birth') || has(o.headings, /passenger|travell?er/));
    return result((field(o, 'first_name') && field(o, 'last_name')) || (s.length >= 2 && has(o.headings, /passenger|travell?er/)), strong ? 'high' : 'medium', s);
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
