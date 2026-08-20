/**
 * Anti-Bot signatures — the raw pattern library detectors.js classifies
 * against. Kept as data, separate from detection logic, so new patterns can
 * be added without touching the classification code.
 */

/** Network-level errors thrown by page.goto() itself — no response was ever received to inspect. */
export const NETWORK_ERROR_PATTERNS = [
  { id: 'http2_protocol_error', regex: /ERR_HTTP2_PROTOCOL_ERROR/i, permanent: false },
  { id: 'connection_reset', regex: /ERR_CONNECTION_RESET/i, permanent: false },
  { id: 'connection_refused', regex: /ERR_CONNECTION_REFUSED/i, permanent: false },
  { id: 'connection_closed', regex: /ERR_CONNECTION_CLOSED/i, permanent: false },
  { id: 'timeout', regex: /Timeout \d+ms exceeded|ERR_TIMED_OUT|net::ERR_TIMED_OUT/i, permanent: false },
  { id: 'name_not_resolved', regex: /ERR_NAME_NOT_RESOLVED/i, permanent: true }, // DNS doesn't resolve — no browser strategy fixes this
  { id: 'ssl_error', regex: /ERR_SSL_PROTOCOL_ERROR|ERR_CERT_/i, permanent: true }, // cert/TLS misconfiguration, not bot defense
];

/** HTTP status codes commonly used by bot-defense systems for a hard block. */
export const BLOCK_STATUS_CODES = new Set([403, 404, 429, 444, 503]);

/** Status codes that are essentially never recoverable by retrying navigation. */
export const PERMANENT_STATUS_CODES = new Set([410, 451]);

/**
 * Content signatures: [classification id, permanent?, RegExp tested against
 * lowercased page title + body text]. Order matters — first match wins, so
 * more specific vendor signatures are listed before generic ones.
 */
export const CONTENT_SIGNATURES = [
  ['cloudflare_challenge', false, /checking your browser|just a moment|cf-browser-verification|cf-chl-|attention required.{0,40}cloudflare|cloudflare ray id/i],
  ['akamai_challenge', false, /access denied.{0,60}akamai|ak_bmsc|_abck|akamai bot manager|reference #\d+\.[a-f0-9]+/i],
  // "Pardon Our Interruption" is Imperva/Incapsula's standard challenge page
  // title — real, confirmed case: it sits inside a <noscript> tag, so it
  // never appears in rendered innerText/title under a real browser (only in
  // raw HTML — see probe.js, which now also scans page.content() for this
  // reason, not just title+innerText).
  ['imperva_challenge', false, /pardon our interruption|imperva|incapsula|reeseskipexpirationcheck|__imperva_interstitial/i],
  ['perimeterx_challenge', false, /perimeterx|px-captcha|_pxhd|please verify you are a human/i],
  ['captcha_page', false, /captcha|recaptcha|hcaptcha|verify you are human|i'm not a robot/i],
  ['security_check_interstitial', false, /security check|unusual (browser )?behavior|automated (queries|access)|unusual traffic/i],
  ['generic_bot_challenge', false, /bot detection|are you a robot|please enable javascript and cookies|access to this page has been denied/i],
  ['explicit_permanent_block', true, /you have been (permanently )?blocked|this ip (address )?has been banned|your access .{0,20}permanently restricted/i],
];
