/**
 * autonomous_navigator/safeSyntheticProfile — turns the existing synthetic
 * TestProfile into a Stagehand `variables` map.
 *
 * Why `variables` and not literal text in the instruction: Stagehand only ever
 * sends the model the variable NAME + description; the actual value is
 * substituted locally when a tool fills a field. So no synthetic PII ever
 * reaches the LLM, the trajectory, or our logs — the agent uses `%originCode%`
 * etc. and Stagehand swaps in "JED" at actuation time.
 */
import { buildTestProfile, isoDateOffset, ALTERNATE_ROUTES } from '../goal_navigator/syntheticData.js';

export { buildTestProfile, isoDateOffset, ALTERNATE_ROUTES };

/**
 * @param {object} profile  buildTestProfile() output
 * @returns {Record<string, { value: string, description: string }>}
 */
export function toAgentVariables(profile) {
  const p = profile || buildTestProfile();
  return {
    originCode: { value: p.trip.origin, description: 'IATA code of the departure airport to search from' },
    originCity: { value: p.trip.originName, description: 'departure city name (use if the field wants a city, not a code)' },
    destinationCode: { value: p.trip.destination, description: 'IATA code of the arrival airport' },
    destinationCity: { value: p.trip.destinationName, description: 'arrival city name' },
    departDate: { value: p.trip.departDate, description: 'outbound travel date, ISO YYYY-MM-DD (about 30 days out)' },
    returnDate: { value: p.trip.returnDate, description: 'return travel date, ISO YYYY-MM-DD (about 35 days out)' },
    adults: { value: String(p.trip.adults), description: 'number of adult passengers' },
    cabin: { value: p.trip.cabin, description: 'cabin class to select' },
    title: { value: p.passenger.title, description: 'passenger title / salutation' },
    firstName: { value: p.passenger.firstName, description: 'passenger first / given name' },
    lastName: { value: p.passenger.lastName, description: 'passenger last / family name' },
    fullName: { value: p.passenger.fullName, description: 'passenger full name' },
    dob: { value: p.passenger.dateOfBirth, description: 'passenger date of birth, ISO YYYY-MM-DD' },
    gender: { value: p.passenger.gender, description: 'passenger gender, if the form requires it' },
    nationality: { value: p.passenger.nationality, description: 'passenger nationality / country' },
    email: { value: p.contact.email, description: 'contact email address (synthetic, non-routable)' },
    phone: { value: p.contact.phoneLocal, description: 'contact phone number, local format (synthetic)' },
    phoneCountryCode: { value: p.contact.phoneCountryCode, description: 'phone country dialling code' },
    addressLine1: { value: p.address.line1, description: 'street address line 1' },
    city: { value: p.address.city, description: 'address city (only for a billing/contact address, never a flight search)' },
    postalCode: { value: p.address.postalCode, description: 'postal / ZIP code' },
    country: { value: p.address.country, description: 'address country' },
  };
}

/** The alternate origin/destination pairs the agent may try if a route is rejected. */
export function alternateRouteHint() {
  return ALTERNATE_ROUTES.map((r) => `${r.origin}→${r.destination}`).join(', ');
}
