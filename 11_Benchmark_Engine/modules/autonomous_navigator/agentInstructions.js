/**
 * autonomous_navigator/agentInstructions — the ONE high-level objective handed
 * to a UNIVERSAL web agent. NOTHING here is airline / travel / e-commerce
 * specific: the target feature is dynamic, and the route to it must emerge from
 * whatever the live website shows. Our code owns the task, the safety limits,
 * the synthetic data, the budget, and independent verification; the agent owns
 * the navigation strategy and the choice of interaction method (DOM vs visual).
 */

// Short, generic hints for a handful of common target words — used only to help
// the agent recognise "am I there yet"; our targetVerifier is the real judge.
// Keyed by lowercase substring of the requested feature. NOT a route.
const TARGET_HINT = [
  [['passenger', 'traveller', 'traveler', 'guest details', 'contact details'], 'a form asking for a person\'s details (first name, last name, title, date of birth, contact info)'],
  [['payment', 'billing', 'pay '], 'a page showing payment methods / card & billing fields / an order total — REACH it, do NOT enter card details or submit payment'],
  [['checkout'], 'the checkout page (order summary, delivery/billing, a place-order area) — REACH it, do NOT place the order'],
  [['cart', 'basket', 'bag'], 'the shopping cart / basket view listing the items to be purchased'],
  [['seat'], 'a seat map / seat picker (a grid of selectable seats)'],
  [['fare', 'bundle', 'plan selection', 'tier'], 'a screen comparing options / bundles / tiers with a choose/select action per option'],
  [['results', 'listing', 'search results'], 'a results list with multiple options and a select/view action each'],
  [['sign up', 'signup', 'register', 'create account', 'account creation', 'get started', 'join'], 'the account-creation / sign-up form — REACH it, do NOT submit real credentials or complete registration'],
  [['sign in', 'signin', 'log in', 'login'], 'the sign-in / login form — REACH it, do NOT log in'],
  [['pricing', 'plans'], 'the pricing / plans page listing tiers and prices'],
  [['quote', 'estimate'], 'a quote / estimate form or the resulting quote'],
  [['booking', 'reservation', 'appointment'], 'the booking / reservation / appointment step where dates, people, and details are entered'],
  [['manage', 'my account', 'dashboard', 'profile'], 'the account / management surface (may require sign-in — if so, stop and report that)'],
];

function targetHint(feature) {
  const t = String(feature || '').toLowerCase();
  for (const [keys, hint] of TARGET_HINT) if (keys.some((k) => t.includes(k))) return hint;
  return `the "${feature}" experience — a distinct page or step whose purpose clearly matches that name`;
}

export function buildSystemPrompt() {
  return [
    'You are a senior UX researcher navigating ANY public website in a real browser to reach a specific target experience so it can be screenshotted and analysed. The website could be a store, a travel site, a bank, a SaaS product, an insurance or healthcare site — anything. Do not assume a domain.',
    '',
    'HOW YOU WORK, every step:',
    '1. PERCEIVE — read the current page: its headings, forms and fields, buttons, links, dialogs, visible text, and the screenshot.',
    '2. DECIDE the next concrete milestone that moves you toward the target (e.g. "fill and submit this search form", "add an item to the cart", "choose a plan", "open the checkout", "continue past this step").',
    '3. ACT using the best method:',
    '   - Prefer semantic DOM actions (act / fillForm by accessible label or role).',
    '   - If a control is a custom widget (fancy dropdown, autocomplete, calendar, slider, canvas, clickable div) OR a DOM action just failed OR the page did not change, SWITCH to a visual/coordinate interaction (click/type at the element you can see in the screenshot).',
    '   - Use scroll, keyboard keys, wait, and go-back as needed.',
    '4. VERIFY the effect: did the URL, the visible state, a field value, a selected option, a dialog, or the screenshot actually change? If nothing observably changed, the action FAILED — try a DIFFERENT method, do not repeat the same one.',
    '5. Keep going across as many pages as needed until the target is on screen.',
    '',
    'RULES:',
    '- Fill forms only with the synthetic test values provided as variables. Never invent personal data.',
    '- NEVER: sign in, create/submit an account, enter a password / OTP / verification code, enter a card number / CVV / expiry, redeem points, or click anything that completes a purchase, places an order, sends money, confirms an irreversible booking, deletes, or publishes.',
    '- If the target IS a payment / checkout / sign-up / booking page: REACH it (see the fields / summary) and then STOP — do not fill secrets or submit.',
    '- Dismiss cookie/consent banners and close marketing pop-ups as your first move.',
    '- Do not stop just because the target is not on the current page — your job is to FIND and REACH it. But if you get genuinely stuck (a control cannot be operated by any method, or the flow requires signing in / a real account / a real reference), stop and explain exactly what blocked you.',
    '- Do not repeat an identical failed action. Escalate the method instead.',
    '',
    'When the target experience is visibly on screen: take a screenshot and call done with a one-line explanation of why this is the target.',
  ].join('\n');
}

/**
 * @param {object} args
 * @param {string} args.company
 * @param {string} args.feature      the user-facing feature label
 * @param {string} [args.detectorKey]
 * @param {string} args.startingUrl
 */
export function buildAgentInstruction({ company, feature, startingUrl }) {
  return [
    `Website: ${company || 'this company'} — ${startingUrl}`,
    `TARGET EXPERIENCE TO REACH: ${feature}.`,
    `You will know you are there when you see: ${targetHint(feature)}.`,
    '',
    'The homepage is already open. Work through the site\'s own public flow using the synthetic variables provided — search, choose options, add to cart, fill multi-step forms, continue past interstitials, skip optional extras — whatever this particular site requires to get to the target.',
    'Do not sign in, do not pay, do not submit anything irreversible. When the target is visible, screenshot it and call done.',
  ].join('\n');
}

export { targetHint };
