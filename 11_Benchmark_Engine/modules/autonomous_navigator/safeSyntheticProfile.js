/**
 * autonomous_navigator/safeSyntheticProfile — a GENERIC synthetic identity +
 * common form values, exposed as a Stagehand `variables` map.
 *
 * Stagehand only ever sends the model the variable NAME + description; the real
 * value is substituted locally at actuation. So no synthetic PII reaches the
 * LLM, the trajectory, or our logs — the agent writes `%firstName%` and
 * Stagehand fills "Alex".
 *
 * Nothing here is domain-specific. `origin`/`destination` are generic
 * "search from / search to" location values usable by any site with a
 * location search (travel, real-estate, delivery, …); every other value is a
 * plain person / contact / address / quantity field.
 */
import { buildTestProfile, isoDateOffset, ALTERNATE_ROUTES } from '../goal_navigator/syntheticData.js';

export { buildTestProfile, isoDateOffset, ALTERNATE_ROUTES };

/**
 * @param {object} profile  buildTestProfile() output
 * @returns {Record<string, { value: string, description: string }>}
 */
export function toAgentVariables(profile) {
  const p = profile || buildTestProfile();
  const days = (n) => isoDateOffset(n);
  return {
    // ── person ──────────────────────────────────────────────────────────
    title: { value: p.passenger.title, description: 'title / salutation (Mr, Ms, …)' },
    firstName: { value: p.passenger.firstName, description: 'first / given name' },
    lastName: { value: p.passenger.lastName, description: 'last / family / surname' },
    fullName: { value: p.passenger.fullName, description: 'full name' },
    dob: { value: p.passenger.dateOfBirth, description: 'date of birth, ISO YYYY-MM-DD (a safe adult date)' },
    gender: { value: p.passenger.gender, description: 'gender, if a form requires it' },
    nationality: { value: p.passenger.nationality, description: 'nationality / citizenship country' },
    companyName: { value: 'Test Research Co', description: 'company / organisation name, if a form asks for one' },
    // ── contact ─────────────────────────────────────────────────────────
    email: { value: p.contact.email, description: 'email address (synthetic, non-routable — RFC 2606 reserved domain)' },
    phone: { value: p.contact.phoneLocal, description: 'phone number, local format (synthetic, reserved range)' },
    phoneCountryCode: { value: p.contact.phoneCountryCode, description: 'phone country dialling code' },
    phoneFull: { value: p.contact.phone, description: 'phone number in full international format' },
    // ── address ─────────────────────────────────────────────────────────
    addressLine1: { value: p.address.line1, description: 'street address line 1' },
    addressLine2: { value: p.address.line2 || 'Suite 2', description: 'street address line 2 / apartment' },
    city: { value: p.address.city, description: 'address city / town' },
    state: { value: p.address.state, description: 'state / province / region' },
    postalCode: { value: p.address.postalCode, description: 'postal / ZIP / PIN code' },
    country: { value: p.address.country, description: 'address country' },
    // ── search / quantity / dates (generic) ─────────────────────────────
    origin: { value: p.trip.origin, description: 'a "from" / origin / pick-up location — an airport code or city; also usable as an IATA code' },
    originCity: { value: p.trip.originName, description: 'the "from" location as a city name' },
    destination: { value: p.trip.destination, description: 'a "to" / destination / drop-off location — an airport code or city' },
    destinationCity: { value: p.trip.destinationName, description: 'the "to" location as a city name' },
    startDate: { value: days(30), description: 'a start / check-in / departure / appointment date, ISO YYYY-MM-DD (~30 days out)' },
    endDate: { value: days(35), description: 'an end / check-out / return date, ISO YYYY-MM-DD (~35 days out)' },
    // travel-flavoured aliases kept for sites that use those exact words
    departDate: { value: p.trip.departDate, description: 'outbound / departure date, ISO YYYY-MM-DD' },
    returnDate: { value: p.trip.returnDate, description: 'return / inbound date, ISO YYYY-MM-DD' },
    quantity: { value: '1', description: 'a generic quantity / count' },
    numberOfPeople: { value: String(p.trip.adults), description: 'number of adults / guests / travellers / passengers' },
    cabinOrClass: { value: p.trip.cabin, description: 'a class / tier / cabin option (Economy, Standard, Basic …)' },
    searchTerm: { value: 'test', description: 'a generic search query when a site needs one to proceed' },
    message: { value: 'This is a benchmark test enquiry — please ignore.', description: 'free-text message / notes / enquiry body' },
  };
}
