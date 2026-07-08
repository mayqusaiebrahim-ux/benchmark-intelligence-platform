# Step 01 — Entry
**Company:** Booking.com | **Benchmark #4**

## Summary
Booking.com's homepage delivers the clearest example of geo-aware cold start in the benchmark set. Without any login or prior session, the homepage immediately displayed SAR currency, Arabic-script destination labels, and pre-populated destination chips for Jeddah, Mecca, and Madinah — the three most strategically important cities in Saudi Arabia. This is silent, friction-free personalization: the product already knows where you are and acts on it before you say a word.

The second AI entry point is the "Quick and easy trip planner" vibe selector — 9 mood/experience categories (Desert Adventures, Family Fun, Romance, Cultural Immersion, etc.) each pre-populated with Saudi-relevant destination chips. This is AI-as-inspiration: instead of asking "where do you want to go?", Booking.com asks "what kind of experience do you want?" and maps the answer onto available destinations automatically.

## Evidence
- `[OBSERVED]` — Homepage loaded with SAR currency, Arabic destinations, Saudi city chips
- `[OBSERVED]` — Trip planner with 9 vibe categories and "Desert Adventures" selection
- `[OBSERVED]` — Al-ʿUla destination chip pre-populated in Desert Adventures vibe

## Screenshots
- `01_entry/01_bookingcom_homepage_first_load.png` — First load with Saudi geo-personalization active
- `01_entry/02_bookingcom_trip_planner_vibe_selector.png` — 9-category vibe selector
- `01_entry/03_bookingcom_trip_planner_desert_selected.png` — Desert Adventures selected, Saudi destination chips

## AI Patterns Observed
| Pattern | Status |
|---------|--------|
| Geo-aware cold start | ✅ Present — SAR, Arabic, Saudi cities without login |
| Vibe-based exploration | ✅ Present — 9 mood categories |
| Cultural personalization | ✅ Present — Halal, Mecca, Madinah surfaced |
| NLP entry | ❌ Absent — no chat or text-first interface |
| Voice entry | ❌ Absent |

## Innovation Filter Assessment
**PASSES** — The combination of geo-aware cold start + vibe-based trip planner at the entry layer represents a meaningful departure from the standard search-form entry. No other OTA benchmarked shows this level of silent personalization at first load.

## Scores
| Dimension | Score |
|-----------|-------|
| Clarity | 4.0 |
| AI Sophistication | 3.5 |
| Personalization | 4.5 |
| Delight | 3.5 |
| Innovation | 3.8 |
| **Step Score** | **3.9** |

## The 5 Mandatory Questions
1. **What is Booking.com doing?** Silently detecting geography and pre-loading culturally relevant content before any user input.
2. **Why is this valuable UX?** Eliminates the cold start problem. The first thing a Saudi traveler sees is already for them.
3. **What trend does it represent?** Geo-aware AI cold start becoming table stakes for global OTAs.
4. **How could this evolve?** Combine geo-awareness with device-time data: "It's Friday afternoon in Riyadh — weekend getaway?" → instant weekend-optimized results.
5. **Saudia opportunity?** Saudia knows more than Booking.com at the entry moment: it knows the traveler's Alfursan tier, past routes, and upcoming bookings. Saudia's entry experience should be even more personalized than Booking.com's.
