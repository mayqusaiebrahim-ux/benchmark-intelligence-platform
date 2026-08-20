/**
 * Discovery — raw signal extraction.
 * The only file that reads DOM state. One evaluate() pass per call — this file
 * never clicks; it only reports what it observed, including candidate targets
 * (by accessible name/ARIA state) that actions.js may later decide to act on.
 *
 * Deliberately no vendor selector tables (no '#onetrust-...', no '.intercom-...').
 * Every detector here is structural (position/geometry), semantic (ARIA role/
 * attributes, HTML input types), or content-based (visible text) — conventions
 * that hold across arbitrary sites, not one specific product's markup.
 */

const AI_KEYWORDS = [
  'ai ', ' ai', 'artificial intelligence', 'assistant', 'chatbot', 'chat with',
  'ask ai', 'planner', 'trip planner', 'genie', 'copilot', 'smart search',
  'personalized', 'concierge',
];
const SEARCH_KEYWORDS = ['search', 'find flights', 'book flights', 'where to', 'destination', 'departure'];
const LOGIN_KEYWORDS = ['sign in', 'log in', 'login', 'my account', 'my trips', 'my bookings', 'register', 'create account'];
const LANGUAGE_KEYWORDS = ['select language', 'choose your language', 'currency'];
const APP_STORE_HINTS = ['apps.apple.com', 'play.google.com'];

const CONSENT_TEXT_PATTERN = 'cookie|consent|gdpr|privacy preferences|personali[sz]ed ads|we use.*(data|cookies)';
const ACCEPT_LABEL_PATTERN = "^(accept(\\s+all)?(\\s+cookies)?|agree(\\s*&\\s*continue)?|allow all|got it|i understand|okay|ok)$";
const DENY_LABEL_PATTERN = 'reject|manage preferences|customi[sz]e|cookie settings|more options';
const MENU_TOGGLE_PATTERN = 'menu|navigation';
const AI_WIDGET_PATTERN = 'chat|assistant|virtual agent|ask (us|ai)|help center|support bot';

export async function extractRawSignals(page) {
  return page.evaluate(
    ({ aiKeywords, searchKeywords, loginKeywords, languageKeywords, appStoreHints, consentTextSrc, acceptLabelSrc, denyLabelSrc, menuToggleSrc, aiWidgetSrc }) => {
      const consentTextPattern = new RegExp(consentTextSrc, 'i');
      const acceptLabelPattern = new RegExp(acceptLabelSrc, 'i');
      const denyLabelPattern = new RegExp(denyLabelSrc, 'i');
      const menuTogglePattern = new RegExp(menuToggleSrc, 'i');
      const aiWidgetPattern = new RegExp(aiWidgetSrc, 'i');

      function textOf(el) {
        return (el.innerText || el.textContent || '').trim();
      }

      function isVisible(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      // ── Navigation / CTAs / forms — unchanged generic extraction ──────────
      const navLinks = Array.from(document.querySelectorAll('nav a, header a'))
        .map(a => ({ label: textOf(a).slice(0, 80), href: a.getAttribute('href') || '' }))
        .filter(l => l.label)
        .slice(0, 60);

      const footerLinks = Array.from(document.querySelectorAll('footer a'))
        .map(a => ({ label: textOf(a).slice(0, 80), href: a.getAttribute('href') || '' }))
        .filter(l => l.label)
        .slice(0, 60);

      const ctaButtons = Array.from(document.querySelectorAll('a, button'))
        .filter(el => {
          const cls = (el.className || '').toString().toLowerCase();
          return el.tagName === 'BUTTON' || cls.includes('cta') || cls.includes('btn-primary') || cls.includes('button-primary');
        })
        .map(el => ({ label: textOf(el).slice(0, 80), href: el.getAttribute('href') || '' }))
        .filter(c => c.label)
        .slice(0, 40);

      const forms = Array.from(document.querySelectorAll('form')).map(f => ({
        hasSearchInput: !!f.querySelector('input[type="search"], input[name*="search" i], input[placeholder*="search" i]'),
        hasDateInput: !!f.querySelector('input[type="date"], [class*="date" i], [id*="date" i]'),
        hasLocationInput: !!f.querySelector('[name*="origin" i], [name*="destination" i], [placeholder*="from" i], [placeholder*="to" i]'),
      }));

      const bodyText = textOf(document.body).slice(0, 20000).toLowerCase();
      const aiCopyHints = aiKeywords.filter(k => bodyText.includes(k));
      const searchCopyHints = searchKeywords.filter(k => bodyText.includes(k));
      const loginHints = loginKeywords.filter(k => bodyText.includes(k));
      const languageSelectorHints = languageKeywords.filter(k => bodyText.includes(k));

      const hasLanguageSelectEl = Array.from(document.querySelectorAll('select')).some(s => {
        const id = (s.id || '').toLowerCase();
        const cls = (s.className || '').toString().toLowerCase();
        return id.includes('lang') || cls.includes('lang') || id.includes('locale') || cls.includes('locale');
      });

      const hreflangs = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'))
        .map(l => l.getAttribute('hreflang'))
        .filter(Boolean);

      const appStoreLinks = Array.from(new Set(
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.getAttribute('href') || '')
          .filter(href => appStoreHints.some(hint => href.includes(hint)))
      )).slice(0, 10);

      // ── Consent candidate — structural (fixed/sticky) + content match ─────
      // Not a vendor lookup: any element that (a) is pinned via CSS position,
      // (b) is currently visible, and (c) reads like a cookie/consent notice.
      const fixedEls = Array.from(document.querySelectorAll('body *')).filter(el => {
        const style = window.getComputedStyle(el);
        return (style.position === 'fixed' || style.position === 'sticky') && isVisible(el);
      });
      const bannerCandidates = fixedEls.filter(el => {
        const text = textOf(el);
        return text.length >= 10 && text.length <= 2000 && consentTextPattern.test(text);
      });

      let consentCandidate = null;
      if (bannerCandidates.length) {
        // Smallest matching container = most specific banner, not a huge page wrapper.
        const el = bannerCandidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.width * ra.height - rb.width * rb.height;
        })[0];

        const clickable = Array.from(el.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
        const acceptCandidates = clickable
          .map(c => ({ name: (textOf(c) || c.value || c.getAttribute('aria-label') || '').trim() }))
          .filter(c => c.name && acceptLabelPattern.test(c.name) && !denyLabelPattern.test(c.name));

        consentCandidate = { text: textOf(el).slice(0, 300), acceptCandidates };
      }

      // ── Navigation-menu toggle candidate — ARIA state, not a fixed id ─────
      const toggleCandidates = Array.from(document.querySelectorAll('header *, nav *, [role="banner"] *')).filter(el => {
        const isButtonish = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
        if (!isButtonish) return false;
        const ariaExpanded = el.getAttribute('aria-expanded');
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        return ariaExpanded !== null || menuTogglePattern.test(ariaLabel) || menuTogglePattern.test(title);
      });

      let navToggleCandidate = null;
      if (toggleCandidates.length) {
        const el = toggleCandidates[0];
        const ariaExpandedAttr = el.getAttribute('aria-expanded');
        navToggleCandidate = {
          name: (el.getAttribute('aria-label') || textOf(el) || el.getAttribute('title') || 'menu').trim().slice(0, 60),
          ariaExpanded: ariaExpandedAttr === null ? null : ariaExpandedAttr === 'true',
        };
      }

      // ── AI/chat widget candidates — corner-anchored geometry + ARIA name ──
      const aiWidgetCandidates = Array.from(document.querySelectorAll('body *'))
        .filter(el => {
          const style = window.getComputedStyle(el);
          if (style.position !== 'fixed' || !isVisible(el)) return false;
          const rect = el.getBoundingClientRect();
          const nearEdge = (window.innerWidth - rect.right < 60) || rect.left < 60;
          const nearBottom = (window.innerHeight - rect.bottom) < 120;
          const smallish = rect.width > 20 && rect.width < 120 && rect.height > 20 && rect.height < 120;
          return nearEdge && nearBottom && smallish;
        })
        .slice(0, 5)
        .map(el => {
          const name = (el.getAttribute('aria-label') || el.getAttribute('title') || textOf(el) || '').trim().slice(0, 80);
          return { name, keywordMatch: aiWidgetPattern.test(name) };
        });

      // ── Full-viewport overlays that are NOT the consent banner — reported
      // as an obstacle only; this module is not authorized to dismiss these. ──
      const overlayHints = fixedEls
        .filter(el => !bannerCandidates.includes(el))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          const viewportArea = window.innerWidth * window.innerHeight;
          return rect.width * rect.height > viewportArea * 0.5;
        })
        .slice(0, 5)
        .map(el => (el.getAttribute('aria-label') || el.id || el.className || el.tagName || '').toString().slice(0, 80));

      return {
        title: document.title || '',
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
        htmlLang: document.documentElement.getAttribute('lang') || '',
        hreflangs,
        navLinks,
        footerLinks,
        ctaButtons,
        forms,
        aiCopyHints,
        searchCopyHints,
        loginHints,
        languageSelectorHints,
        hasLanguageSelectEl,
        appStoreLinks,
        consentCandidate,
        navToggleCandidate,
        aiWidgetCandidates,
        overlayHints,
      };
    },
    {
      aiKeywords: AI_KEYWORDS,
      searchKeywords: SEARCH_KEYWORDS,
      loginKeywords: LOGIN_KEYWORDS,
      languageKeywords: LANGUAGE_KEYWORDS,
      appStoreHints: APP_STORE_HINTS,
      consentTextSrc: CONSENT_TEXT_PATTERN,
      acceptLabelSrc: ACCEPT_LABEL_PATTERN,
      denyLabelSrc: DENY_LABEL_PATTERN,
      menuToggleSrc: MENU_TOGGLE_PATTERN,
      aiWidgetSrc: AI_WIDGET_PATTERN,
    }
  );
}
