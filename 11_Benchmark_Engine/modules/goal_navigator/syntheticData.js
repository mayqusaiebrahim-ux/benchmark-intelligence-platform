/**
 * goal_navigator/syntheticData — the ONLY source of values the goal navigator
 * ever types into a form.
 *
 * Every value here is deliberately synthetic and non-routable:
 *  - the email domain is `example.com` (RFC 2606 — reserved, can never be a
 *    real inbox);
 *  - the phone number is in the reserved 555-01xx range;
 *  - the name is literally "Test Traveler";
 *  - no real Alfursan / frequent-flyer number, no promo code, no card data.
 *
 * There is NO code path that reads a real user's PII into these fields. If a
 * form needs something not modelled here, the autofill planner leaves it
 * blank and the navigator reports the blocker rather than guessing.
 */

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD, `days` from `from` (default: today, UTC). */
export function isoDateOffset(days, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Stable alternative routes — used if the primary pair is rejected by a
// route-validation step ("we don't fly JED–DXB on that date").
export const ALTERNATE_ROUTES = [
  { origin: 'JED', destination: 'RUH' },
  { origin: 'JED', destination: 'DOH' },
  { origin: 'RUH', destination: 'DXB' },
];

/**
 * buildTestProfile — one synthetic traveller + trip. `now` is injectable so
 * tests are deterministic.
 */
export function buildTestProfile({ now = new Date() } = {}) {
  return {
    trip: {
      tripType: 'round_trip',          // fall back to one_way if that flow is simpler
      origin: 'JED',
      originName: 'Jeddah',
      destination: 'DXB',
      destinationName: 'Dubai',
      departDate: isoDateOffset(30, now),
      returnDate: isoDateOffset(35, now),
      adults: 1,
      children: 0,
      infants: 0,
      cabin: 'Economy',
      promoCode: '',
    },
    passenger: {
      title: 'Mr',
      firstName: 'Test',
      lastName: 'Traveler',
      fullName: 'Test Traveler',
      // A safe adult DOB — comfortably over 18, fixed so tests are stable.
      dateOfBirth: '1990-01-15',
      gender: 'Male',
      nationality: 'Saudi Arabia',
      countryOfResidence: 'Saudi Arabia',
      frequentFlyer: '',              // never a real membership number
    },
    contact: {
      // RFC 2606 reserved domain — can never reach a real inbox.
      email: 'benchmark.test.traveler@example.com',
      phoneCountryCode: '+966',
      // Reserved fictitious-use range (555-0100..555-0199).
      phone: '+966555550142',
      phoneLocal: '0555550142',
    },
    address: {
      line1: '1 Test Street',
      line2: '',
      city: 'Riyadh',
      postalCode: '11564',
      country: 'Saudi Arabia',
      state: 'Riyadh Province',
    },
    // Explicitly empty — the navigator must never invent these.
    payment: null,
    credentials: null,
  };
}

/**
 * The exact set of literal strings this module can emit. Tests assert that no
 * value the autofill planner produces falls outside this set (plus route
 * codes / dates), i.e. "no real personal data can be typed".
 */
export function syntheticValueAllowList(profile = buildTestProfile()) {
  const p = profile;
  return new Set([
    p.trip.origin, p.trip.originName, p.trip.destination, p.trip.destinationName,
    p.trip.departDate, p.trip.returnDate, p.trip.cabin, String(p.trip.adults),
    p.passenger.title, p.passenger.firstName, p.passenger.lastName, p.passenger.fullName,
    p.passenger.dateOfBirth, p.passenger.gender, p.passenger.nationality, p.passenger.countryOfResidence,
    p.contact.email, p.contact.phone, p.contact.phoneLocal, p.contact.phoneCountryCode,
    p.address.line1, p.address.city, p.address.postalCode, p.address.country, p.address.state,
    ...ALTERNATE_ROUTES.flatMap((r) => [r.origin, r.destination]),
  ]);
}
