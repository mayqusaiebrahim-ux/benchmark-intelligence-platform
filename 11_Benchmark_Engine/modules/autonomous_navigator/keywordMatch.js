/**
 * keywordMatch — whole-word, case-insensitive keyword matching for routing a
 * free-text target ("In-flight meal menu", "Hotel search results").
 *
 * Raw substring matching routed targets by accident: "menu" inside "meal
 * menu", "entry" inside "Re-entry", "nav" inside "Navigation", "bag" inside
 * "baggage", "pay" inside "display", "book" inside "Facebook". Here a keyword
 * must stand as its own word(s): letters, digits and hyphens on either side
 * mean it is part of a longer word ("re-entry" is one word, not "entry").
 * Multi-word keywords match across any whitespace; a plural s/es is allowed.
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cache = new Map();
function keywordRegExp(keyword) {
  let re = cache.get(keyword);
  if (!re) {
    const body = escapeRegExp(String(keyword).trim().toLowerCase()).replace(/\s+/g, '\\s+');
    re = new RegExp(`(?<![a-z0-9-])${body}(?:s|es)?(?![a-z0-9-])`, 'i');
    cache.set(keyword, re);
  }
  return re;
}

/** True when `keyword` appears in `text` as a whole word / phrase. */
export function hasKeyword(text, keyword) {
  return keywordRegExp(keyword).test(String(text || ''));
}

/**
 * The most specific (longest) keyword from `table` ([[keywords], value] rows)
 * that appears in `text` as a whole word, or null.
 * @returns {{ value: any, keyword: string } | null}
 */
export function bestKeywordMatch(text, table) {
  let best = null;
  for (const [keywords, value] of table) {
    for (const k of keywords) {
      if ((!best || k.length > best.keyword.length) && hasKeyword(text, k)) best = { value, keyword: k };
    }
  }
  return best;
}
