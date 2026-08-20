/**
 * Discovery — interpretation and decision layer.
 * Pure functions: raw signals (plus any actions actually taken) in, report
 * sections out. No browser access, no AI calls — deterministic, rule-based
 * judgment only. This is where the agent "decides" what it saw and what to
 * do next; actions.js is where it acts, signals.js is where it observes.
 */

const JOURNEY_KEYWORDS = {
  step_01_entry: [],
  step_02_discovery: ['discover', 'explore', 'inspiration', 'destinations', 'things to do', 'guide', 'deals'],
  step_03_search: ['search', 'flights', 'hotels', 'find flights', 'book now'],
  step_04_ai_interaction: ['ai', 'assistant', 'chat', 'planner', 'ask ai', 'genie', 'copilot', 'concierge'],
  step_05_recommendations: ['recommended', 'for you', 'personalized', 'trending', 'top picks'],
  step_06_maps: ['map', 'nearby', 'explore map'],
  step_07_booking: ['book', 'booking', 'reserve', 'checkout'],
  step_08_ancillaries: ['extras', 'add-ons', 'baggage', 'seat selection', 'upgrade'],
  step_09_payment: ['payment', 'pay', 'wallet', 'buy now pay later', 'bnpl'],
  step_10_trip_management: ['my trips', 'manage booking', 'itinerary', 'my bookings', 'trip dashboard'],
  step_11_checkin: ['check-in', 'check in', 'boarding pass'],
  step_12_loyalty: ['loyalty', 'rewards', 'miles', 'points', 'membership', 'frequent flyer'],
};

const GOAL_PHRASES = {
  step_02_discovery: 'Discover destinations and travel inspiration',
  step_03_search: 'Search for flights, hotels, or trips',
  step_04_ai_interaction: 'Get AI-assisted trip planning or support',
  step_05_recommendations: 'Receive personalized recommendations',
  step_06_maps: 'Explore destinations via map',
  step_07_booking: 'Book a trip',
  step_08_ancillaries: 'Add extras (baggage, seats, upgrades)',
  step_09_payment: 'Complete payment, including BNPL where offered',
  step_10_trip_management: 'Manage an existing booking or itinerary',
  step_11_checkin: 'Check in for a flight',
  step_12_loyalty: 'Track or redeem loyalty rewards',
};

const CATEGORY_KEYWORDS = {
  Airline: ['flight status', 'check-in', 'boarding pass', 'baggage allowance', 'frequent flyer', 'business class', 'economy class'],
  OTA: ['compare prices', 'hotels', 'car rental', 'vacation packages', 'book your stay'],
  'AI-first': ['ai trip planner', 'ask ai', 'travel assistant', 'itinerary generator'],
  'Super App': ['ride', 'food delivery', 'super app', 'wallet'],
};

function matchesKeyword(text, keywords) {
  const t = (text || '').toLowerCase();
  return keywords.some(k => t.includes(k));
}

export function classifyWebsite(raw) {
  const haystack = [raw.title, raw.metaDescription, ...raw.navLinks.map(l => l.label), ...raw.ctaButtons.map(l => l.label)]
    .join(' ')
    .toLowerCase();

  let best = { type: 'Other/Unknown', hits: 0 };
  for (const [type, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = keywords.filter(k => haystack.includes(k)).length;
    if (hits > best.hits) best = { type, hits };
  }
  return { website_type: best.type };
}

export function detectAiFeatures(raw) {
  const findings = [];

  const strongWidget = raw.aiWidgetCandidates.find(c => c.keywordMatch);
  if (strongWidget) {
    findings.push({
      type: 'chat_widget',
      label: `Floating widget matching AI/chat semantics ("${strongWidget.name || 'unlabeled'}")`,
      evidence: [strongWidget.name || 'corner-anchored widget, ARIA/label match'],
      confidence: 'high',
    });
  } else if (raw.aiWidgetCandidates.length) {
    findings.push({
      type: 'chat_widget',
      label: 'Floating corner widget detected (chat-launcher shaped, no confirming label)',
      evidence: raw.aiWidgetCandidates.map(c => c.name || 'unlabeled'),
      confidence: 'low',
    });
  }

  const aiNavOrCta = [...raw.navLinks, ...raw.ctaButtons].filter(l => matchesKeyword(l.label, JOURNEY_KEYWORDS.step_04_ai_interaction));
  if (aiNavOrCta.length) {
    findings.push({
      type: 'ai_cta',
      label: 'Navigation or CTA referencing AI/assistant/planner',
      evidence: aiNavOrCta.map(l => l.label),
      confidence: 'medium',
    });
  }

  if (raw.aiCopyHints.length) {
    findings.push({
      type: 'mentioned_in_copy',
      label: 'AI-related keywords found in page copy',
      evidence: raw.aiCopyHints,
      confidence: 'low',
    });
  }

  return findings;
}

export function detectSearchCapability(raw) {
  const flightSearchForm = raw.forms.find(f => f.hasDateInput && f.hasLocationInput);
  if (flightSearchForm) return { present: true, type: 'flight_search', evidence: ['form with date + origin/destination inputs'] };

  const genericSearchForm = raw.forms.find(f => f.hasSearchInput);
  if (genericSearchForm) return { present: true, type: 'generic_search', evidence: ['form with a search input'] };

  if (raw.searchCopyHints.length) return { present: true, type: 'generic_search', evidence: raw.searchCopyHints };

  return { present: false, type: 'none', evidence: [] };
}

export function detectAccountCapability(raw) {
  const navHits = raw.navLinks.filter(l => matchesKeyword(l.label, ['sign in', 'log in', 'login', 'my account', 'account', 'register']));
  if (navHits.length) return { present: true, evidence: navHits.map(l => l.label) };
  if (raw.loginHints.length) return { present: true, evidence: raw.loginHints };
  return { present: false, evidence: [] };
}

export function detectLanguageSelector(raw) {
  const present = raw.hasLanguageSelectEl || raw.hreflangs.length > 1 || raw.languageSelectorHints.length > 0;
  const evidence = [
    raw.hasLanguageSelectEl ? 'select element with lang/locale id or class' : null,
    raw.hreflangs.length > 1 ? `${raw.hreflangs.length} hreflang alternates` : null,
    ...raw.languageSelectorHints,
  ].filter(Boolean);
  return { present, detected_languages: raw.hreflangs, evidence };
}

export function detectDeviceIndicators(raw) {
  return {
    responsive_meta_present: /width\s*=\s*device-width/i.test(raw.viewportMeta || ''),
    viewport_meta: raw.viewportMeta || null,
    app_store_links: raw.appStoreLinks,
  };
}

/** buildConsentStatus — reflects whether a banner was found and whether Discovery cleared it itself. */
export function buildConsentStatus(raw, actionsTaken) {
  const dismissAction = actionsTaken.find(a => a.action === 'dismiss_consent_banner');
  if (dismissAction) {
    return { present: true, dismissed: true, evidence: [dismissAction.evidence] };
  }
  if (raw.consentCandidate) {
    return { present: true, dismissed: false, evidence: [raw.consentCandidate.text.slice(0, 160)] };
  }
  return { present: false, dismissed: false, evidence: [] };
}

export function detectObstacles(raw, meta, consentStatus) {
  const obstacles = [];

  if (consentStatus.present && !consentStatus.dismissed) {
    obstacles.push({
      type: 'consent_banner',
      description: 'A cookie/consent banner is present and could not be safely dismissed (no recognizable Accept control found).',
      evidence: consentStatus.evidence,
    });
  }

  if (raw.overlayHints.length) {
    obstacles.push({
      type: 'interstitial_modal',
      description: 'A large fixed/sticky element (not the consent banner) covers most of the viewport — likely a promo, newsletter, or app-download interstitial. Discovery is not authorized to dismiss this.',
      evidence: raw.overlayHints,
    });
  }

  const finalUrlLower = (meta.finalUrl || '').toLowerCase();
  const looksLikeAuthRedirect = ['login', 'signin', 'sign-in', 'auth'].some(k => finalUrlLower.includes(k));
  if (looksLikeAuthRedirect && meta.finalUrl !== meta.requestedUrl) {
    obstacles.push({
      type: 'login_wall',
      description: 'The page redirected to what looks like an authentication URL.',
      evidence: [meta.finalUrl],
    });
  }

  if (meta.status && meta.status >= 400) {
    obstacles.push({
      type: 'blocked_or_error',
      description: `Initial navigation returned HTTP ${meta.status}.`,
      evidence: [String(meta.status)],
    });
  }

  return obstacles;
}

export function buildSuggestedJourney(raw) {
  const haystackItems = [...raw.navLinks, ...raw.ctaButtons, ...raw.footerLinks];
  const confidenceRank = { high: 3, medium: 2, low: 1 };

  const entries = Object.entries(JOURNEY_KEYWORDS).map(([stepId, keywords]) => {
    if (stepId === 'step_01_entry') {
      return { step_id: stepId, applicable_guess: true, confidence: 'high', matched_signals: ['landing page loaded'] };
    }

    const navMatches = haystackItems.filter(item => matchesKeyword(item.label, keywords));
    const copyMatches = keywords.filter(k => raw.aiCopyHints.includes(k) || raw.searchCopyHints.includes(k));
    const applicableGuess = navMatches.length > 0 || copyMatches.length > 0;

    let confidence = 'low';
    if (navMatches.length >= 2) confidence = 'high';
    else if (navMatches.length === 1 || copyMatches.length > 0) confidence = 'medium';

    return {
      step_id: stepId,
      applicable_guess: applicableGuess,
      confidence: applicableGuess ? confidence : 'low',
      matched_signals: navMatches.length ? navMatches.map(m => `${m.label} (${m.href || 'no href'})`) : copyMatches,
    };
  });

  const priorityFirst = ['step_04_ai_interaction', 'step_01_entry'];
  const prioritized = priorityFirst.map(id => entries.find(e => e.step_id === id)).filter(Boolean);
  const rest = entries
    .filter(e => !priorityFirst.includes(e.step_id))
    .sort((a, b) => confidenceRank[b.confidence] - confidenceRank[a.confidence]);

  return [...prioritized, ...rest].map((e, i) => ({ ...e, priority_rank: i + 1 }));
}

export function buildPrimaryUserGoals(suggestedJourney, raw) {
  const goals = suggestedJourney
    .filter(e => e.step_id !== 'step_01_entry' && e.applicable_guess)
    .sort((a, b) => a.priority_rank - b.priority_rank)
    .map(e => GOAL_PHRASES[e.step_id])
    .filter(Boolean);

  if (goals.length) return goals.slice(0, 5);
  return raw.metaDescription ? [raw.metaDescription.slice(0, 160)] : ['Unable to determine from available signals'];
}

export function buildVisibleEntryPoints(raw, aiFeatures, searchCapability, accountCapability) {
  const entries = [];
  raw.navLinks.slice(0, 15).forEach(l => entries.push({ type: 'nav_link', label: l.label, href: l.href || null }));
  raw.ctaButtons.slice(0, 10).forEach(c => entries.push({ type: 'cta', label: c.label, href: c.href || null }));
  aiFeatures.forEach(f => entries.push({ type: 'ai_surface', label: f.label, href: null }));
  if (searchCapability.present) entries.push({ type: 'search_form', label: `Search (${searchCapability.type})`, href: null });
  if (accountCapability.present) entries.push({ type: 'account_link', label: 'Login/account', href: null });
  return entries;
}

export function computeOverallConfidence(raw, suggestedJourney, obstacles) {
  const blocking = obstacles.some(o => o.type === 'blocked_or_error' || o.type === 'login_wall');
  if (blocking) return 'low';

  const evidencedSteps = suggestedJourney.filter(e => e.applicable_guess).length;
  const richSignal = raw.navLinks.length + raw.ctaButtons.length;

  if (evidencedSteps >= 5 && richSignal >= 10) return 'high';
  if (evidencedSteps >= 2 && richSignal >= 4) return 'medium';
  return 'low';
}

/** decideSafeNextAction — the one-line recommendation handed to the orchestrator/Vision. */
export function decideSafeNextAction({ aiFeatures, suggestedJourney, obstacles, consentStatus }) {
  const blockingObstacle = obstacles.find(o => o.type === 'login_wall' || o.type === 'blocked_or_error');
  if (blockingObstacle) {
    return `Escalate to hybrid research (Tier 2/3) — ${blockingObstacle.description}`;
  }

  if (consentStatus.present && !consentStatus.dismissed) {
    return 'Retry discovery or escalate — a consent banner was detected but no recognizable Accept control could be safely identified.';
  }

  const topAiFinding = aiFeatures.find(f => f.confidence === 'high') || aiFeatures[0];
  if (topAiFinding) {
    return `Proceed to Vision: capture step_04_ai_interaction first — AI surface evidenced by "${topAiFinding.label}".`;
  }

  const topStep = suggestedJourney.find(e => e.step_id !== 'step_01_entry' && e.applicable_guess);
  if (topStep) {
    return `Proceed to Vision: no AI surface found on the homepage — capture ${topStep.step_id} next (highest-confidence discovered surface), and re-check for AI deeper in the journey.`;
  }

  return 'Proceed to Vision with low confidence: minimal signal found on the homepage — consider Tier 2 hybrid research alongside capture.';
}
