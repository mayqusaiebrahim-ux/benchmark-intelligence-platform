/**
 * goal_navigator/formAutofill — generic, semantic form understanding.
 *
 * Given a list of field descriptors observed on the page (label, placeholder,
 * aria-label, name, id, role, type, nearby text) and a synthetic TestProfile,
 * produce a fill plan: which field gets which synthetic value, by which
 * method. Semantics are resolved from meaning, never from nth-child / fixed
 * DOM indexes (spec §3).
 *
 * Fields whose semantic is auth- or payment-related (password, booking
 * reference, card number, …) are returned with `blocked: true` and are NEVER
 * assigned a value — the navigator turns those into an AUTH_REQUIRED /
 * IRREVERSIBLE_TRANSACTION stop.
 */

// ordered: first matching rule wins. Each rule: [semantic, regex, appliesToType?]
const RULES = [
  // ── trip / search ──────────────────────────────────────────────────────
  ['origin', /\b(from|origin|departure (airport|city)|leaving from|fly(ing)? from|depart from)\b/],
  ['destination', /\b(to|destination|arrival (airport|city)|going to|fly(ing)? to|where to)\b/],
  ['depart_date', /\b(depart(ure)? date|outbound date|leaving|depart on|start date|going)\b/],
  ['return_date', /\b(return date|inbound date|coming back|return on|end date)\b/],
  ['passengers', /\b(passengers?|travell?ers?|guests?|adults?|who('| i)s (coming|travelling)|number of people)\b/],
  ['cabin', /\b(cabin|class|travel class|cabin class|fare class)\b/],
  ['promo_code', /\b(promo(tional)? code|discount code|voucher code|coupon)\b/],

  // ── passenger identity ────────────────────────────────────────────────
  ['title', /\b(title|salutation|prefix|mr\s*\/\s*mrs)\b/],
  ['first_name', /\b(first name|given name|forename|name \(first\)|passenger first)\b/],
  ['last_name', /\b(last name|surname|family name|name \(last\)|passenger last)\b/],
  ['card_name', /\b(name on card|cardholder( name)?)\b/],
  ['full_name', /\b(full name|name on (id|passport)|passenger name|your name)\b/],
  ['date_of_birth', /\b(date of birth|dob|birth ?date|d\.o\.b)\b/],
  ['gender', /\b(gender|sex)\b/],
  ['nationality', /\b(nationality|citizenship)\b/],
  ['country_of_residence', /\b(country of residence|residing (in|country)|resident country)\b/],

  // ── contact ───────────────────────────────────────────────────────────
  ['email', /\b(e-?mail|email address)\b/],
  ['phone_country_code', /\b(country code|dial(l?ing)? code|phone prefix|\+\d)\b/],
  ['phone', /\b(phone|mobile|telephone|contact number|cell)\b/],

  // ── address ───────────────────────────────────────────────────────────
  ['address_line1', /\b(address( line ?1)?|street( address)?|addr1)\b/],
  ['city', /\b(city|town|suburb)\b/],
  ['postal_code', /\b(post(al)? code|zip( code)?|pincode)\b/],
  ['state', /\b(state|province|region|county)\b/],
  ['country', /\b(country)\b/],

  ['consent_checkbox', /\b(i (agree|accept|have read)|terms (and|&) conditions|privacy (policy|notice)|conditions of carriage|keep me updated|subscribe|newsletter)\b/],
  ['frequent_flyer', /\b(frequent flyer( number)?|privilege club( number)?|skywards( number)?|alfursan( number)?|loyalty (number|card)|ff number)\b/],

  // ── NEVER FILLED — resolved only so the navigator can stop cleanly ─────
  ['password', /\b(password|passcode|pin\b|one[- ]time (code|password)|otp)\b/],
  ['booking_reference', /\b(booking reference|booking ref|pnr|reservation code|e-?ticket number|confirmation (code|number))\b/],
  ['member_id', /\b(member(ship)? id|member number|user ?id|account number)\b/],
  ['card_number', /\b(card number|credit card|debit card|card no)\b/],
  ['card_cvv', /\b(cvv|cvc|security code|card verification)\b/],
  ['card_expiry', /\b(expiry|expiration|valid (thru|until)|mm\s*\/\s*yy)\b/],
  ['card_name', /\b(name on card|cardholder)\b/],
];

const BLOCKED_SEMANTICS = new Set([
  'password', 'booking_reference', 'member_id',
  'card_number', 'card_cvv', 'card_expiry', 'card_name',
]);

/**
 * resolveFieldSemantic — meaning of one field from its accessible signals.
 * @returns {string|null}
 */
export function resolveFieldSemantic(desc = {}) {
  const hay = [desc.label, desc.placeholder, desc.ariaLabel, desc.name, desc.id, desc.nearbyText]
    .filter(Boolean).join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → "camel Case"
    .toLowerCase().replace(/[_-]+/g, ' ');
  if (!hay.trim()) {
    // last resort: input type only
    if (desc.type === 'email') return 'email';
    if (desc.type === 'tel') return 'phone';
    return null;
  }
  // type hints refine ambiguous text
  if (desc.type === 'email' && /mail/.test(hay)) return 'email';
  for (const [semantic, re] of RULES) {
    if (re.test(hay)) return semantic;
  }
  if (desc.type === 'email') return 'email';
  if (desc.type === 'tel') return 'phone';
  return null;
}

/** The synthetic value for a semantic, or null if none / blocked. */
export function valueForSemantic(semantic, profile) {
  if (!semantic || BLOCKED_SEMANTICS.has(semantic)) return null;
  const p = profile;
  switch (semantic) {
    case 'origin': return p.trip.origin;
    case 'destination': return p.trip.destination;
    case 'depart_date': return p.trip.departDate;
    case 'return_date': return p.trip.returnDate;
    case 'passengers': return String(p.trip.adults);
    case 'cabin': return p.trip.cabin;
    case 'promo_code': return '';                       // deliberately empty
    case 'title': return p.passenger.title;
    case 'first_name': return p.passenger.firstName;
    case 'last_name': return p.passenger.lastName;
    case 'full_name': return p.passenger.fullName;
    case 'date_of_birth': return p.passenger.dateOfBirth;
    case 'gender': return p.passenger.gender;
    case 'nationality': return p.passenger.nationality;
    case 'country_of_residence': return p.passenger.countryOfResidence;
    case 'email': return p.contact.email;
    case 'phone': return p.contact.phoneLocal;
    case 'phone_country_code': return p.contact.phoneCountryCode;
    case 'address_line1': return p.address.line1;
    case 'city': return p.address.city;
    case 'postal_code': return p.address.postalCode;
    case 'state': return p.address.state;
    case 'country': return p.address.country;
    case 'frequent_flyer': return '';                   // never a real number
    case 'consent_checkbox': return true;               // non-transactional consent only
    default: return null;
  }
}

function methodFor(desc, semantic) {
  if (semantic === 'consent_checkbox' || desc.type === 'checkbox') return 'check';
  if (desc.role === 'combobox' || desc.tag === 'select' || desc.autocomplete) return 'combobox';
  if (['origin', 'destination', 'nationality', 'country', 'country_of_residence', 'cabin', 'title', 'gender'].includes(semantic)) return 'combobox';
  if (semantic === 'depart_date' || semantic === 'return_date' || semantic === 'date_of_birth') return 'date';
  return 'type';
}

/**
 * planAutofill — the fill plan for every field currently on screen.
 * @returns {{ fills: Array, blocked: Array, unresolved: number }}
 *   fills:   [{ descriptor, semantic, value, method }]
 *   blocked: [{ descriptor, semantic, reason }]   (auth/payment — never filled)
 */
export function planAutofill(fields = [], profile) {
  const fills = [];
  const blocked = [];
  let unresolved = 0;

  for (const descriptor of fields) {
    const semantic = descriptor.semantic || resolveFieldSemantic(descriptor);
    if (!semantic) { unresolved++; continue; }

    if (BLOCKED_SEMANTICS.has(semantic)) {
      blocked.push({
        descriptor, semantic,
        reason: /^card_/.test(semantic)
          ? 'payment card field — filling it would move toward an irreversible transaction'
          : 'authentication field — no synthetic value may be supplied',
      });
      continue;
    }

    const value = valueForSemantic(semantic, profile);
    if (value === null || value === '') { unresolved++; continue; }
    fills.push({ descriptor, semantic, value, method: methodFor(descriptor, semantic) });
  }

  return { fills, blocked, unresolved };
}

export { BLOCKED_SEMANTICS };
