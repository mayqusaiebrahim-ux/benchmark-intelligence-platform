/**
 * autonomous_navigator/agentInstructions — the ONE high-level objective handed
 * to the browser agent. The target feature is dynamic; everything else is a
 * fixed policy. The agent decides HOW to navigate; our code decides the task,
 * the safety limits, the synthetic data, and whether the target was reached.
 */
import { alternateRouteHint } from './safeSyntheticProfile.js';

// Human-readable description of what "reaching" each target means — helps the
// agent know when to call `done`, but our targetVerifier is the real judge.
const TARGET_BRIEF = {
  passenger_details: 'the passenger / traveller details form (first name, last name, title, date of birth, contact details fields)',
  payment: 'the payment page where you choose a payment method / see card and billing fields and an order total — DO NOT enter card details or submit payment',
  seat_selection: 'the seat map / seat selection screen (aircraft cabin grid, selectable seat numbers)',
  fare_selection: 'the fare / branded-fare selection screen (Economy Lite / Classic / Flex style bundles with included-baggage comparisons)',
  flight_results: 'the flight results list (multiple flight options with departure/arrival times and prices, each with a Select action)',
  flight_search: 'the flight search / booking widget with origin, destination, dates and passengers ready to search',
  ancillaries: 'the optional extras / ancillaries screen (extra baggage, meals, insurance) — skip everything, do not add paid extras',
  checkin: 'the online check-in entry screen (booking reference + last name lookup) — do NOT enter a real reference',
  manage_booking: 'the manage-booking / retrieve-trip entry screen — do NOT enter a real reference',
  signin: 'the sign-in / member login screen — do NOT sign in',
  loyalty: 'the loyalty programme page (tiers, earning/redeeming miles)',
};

export function buildSystemPrompt() {
  return [
    'You are a senior UX benchmark researcher navigating a real airline website in a browser.',
    'Your ONLY job is to reach a specific target experience in the public booking journey so it can be screenshotted and analysed.',
    'You navigate like a careful human researcher: read the page, click the right controls, fill forms with the provided synthetic test values, wait for pages to load, and keep going across multiple pages until you reach the target.',
    '',
    'HARD SAFETY RULES — these are also enforced in code, but you must respect them:',
    '- NEVER sign in, create an account, or enter a password / OTP / verification code.',
    '- NEVER enter a real or made-up booking reference, PNR, e-ticket number, or loyalty/frequent-flyer number.',
    '- NEVER enter card number, CVV, expiry, or any payment credential.',
    '- NEVER click "Pay", "Pay now", "Purchase", "Confirm and pay", "Complete booking", "Issue ticket", or anything that completes a paid transaction.',
    '- NEVER redeem miles/points.',
    '- If the target is the payment page: REACH it (see the payment methods / card fields / total) and then STOP. Do not fill or submit anything there.',
    '- Only use the synthetic values provided as variables. Do not invent personal data.',
    '',
    'NAVIGATION GUIDANCE:',
    '- Use the public "Book a flight" journey. Fill origin, destination, dates and passenger count, then search.',
    '- On flight results, pick any reasonable flight (e.g. the first non-stop). On fare selection, pick the cheapest / most basic fare unless it forces a paid add-on.',
    '- Skip all optional extras ("No thanks", "Skip", "Continue without"). Do not add paid seats or bags unless a step cannot be skipped and a free option exists.',
    '- Dismiss cookie/consent banners and close marketing pop-ups.',
    '- Do NOT stop just because the target is not on the current page — your job is to FIND and REACH it. Keep progressing through the flow.',
    '- If a widget is stubborn (autocomplete, calendar), try a different interaction: click a suggestion, use the keyboard, reopen the field, pick another valid future date, or choose an alternate route.',
    `- Alternate origin/destination pairs you may use if a route is unavailable: ${alternateRouteHint()}.`,
    '- When you believe you have reached the target, take a screenshot, then call done with a short explanation of why you think this is the target.',
  ].join('\n');
}

/**
 * @param {object} args
 * @param {string} args.company
 * @param {string} args.feature   the user-facing feature label ("Passenger Details")
 * @param {string} args.detectorKey
 * @param {string} args.startingUrl
 */
export function buildAgentInstruction({ company, feature, detectorKey, startingUrl }) {
  const brief = TARGET_BRIEF[detectorKey] || `the "${feature}" experience`;
  return [
    `Website: ${company} — ${startingUrl}`,
    `TARGET EXPERIENCE TO REACH: ${feature}.`,
    `Concretely, that means: ${brief}.`,
    '',
    'Start from the current page (the homepage is already open). Work through the public booking journey using the synthetic variables provided.',
    detectorKey === 'payment'
      ? 'Complete every reversible prerequisite (search, flight, fare, passenger details with synthetic data, skip extras) until the PAYMENT page is visible, then STOP without entering or submitting anything.'
      : detectorKey === 'seat_selection'
        ? 'Progress through search, results, fare and passenger details as needed until the SEAT MAP is visible.'
        : detectorKey === 'passenger_details'
          ? 'Progress through search, flight results and fare selection until the PASSENGER DETAILS form is visible.'
          : 'Progress through the booking journey until the target experience is visible.',
    '',
    'Do not sign in, do not pay, do not use a real booking reference. Use only the provided synthetic values.',
    'When the target is visible: screenshot it and call done.',
  ].join('\n');
}

export { TARGET_BRIEF };
