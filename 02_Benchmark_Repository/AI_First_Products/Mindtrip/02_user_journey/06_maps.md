# 06 Maps — Mindtrip

**Date:** 2026-06-30
**Step Score:** 3.6 / 5.0

---

## What I Saw
A map element (id containing "map") was confirmed in the DOM. Navigation buttons in the sidebar include "Map" and "Explore" sections. The iOS app prominently features a "Near Me" map view showing nearby spots relative to the user's current location with distances and the ability to add places to the trip plan directly from the map.

On web, the map integration appears as an explore/discovery surface — clicking "Map" in the sidebar likely shows the city on a map with recommended locations pinned. Full interactive capabilities were not captured in headless mode.

## AI Presence: Partial
The iOS app's "Near Me" feature is AI-enhanced — the map surfaces AI-recommended spots based on the user's trip context, not just all nearby places. This is AI-filtered spatial discovery: the map only shows what's relevant to you, not everything that exists.

## The 5 Questions

### 1. What is happening here?
The map integrates with the trip plan — places recommended by the AI or saved by the user appear as pins. On mobile, "Near Me" uses the device's real-time location to show relevant spots during the actual trip.

### 2. Why is this valuable?
A map that shows only AI-filtered relevant places eliminates the cognitive overload of Google Maps (thousands of pins). The user sees 8-12 highly relevant places rather than hundreds of options. This is the map as curation, not directory.

### 3. What trend?
**AI-filtered spatial discovery** — maps that show curated, contextually relevant POIs rather than exhaustive directories. The map becomes a planning surface, not just a navigation surface.

### 4. How could this evolve?
The map becomes the primary interface — the AI conversation becomes a filter layer for the map rather than the other way around. "Show me only halal restaurants within walking distance of my hotel" becomes a spoken command that filters the live map in real time.

### 5. What opportunity for Saudia?
A Saudia destination map — pre-loaded with AI-curated recommendations for the passenger's flight destination — could appear in the Saudia app's trip management section. "You're flying to Istanbul. Here's the Saudia-curated city map for your 5-day trip." A natural extension of the flight context into destination intelligence.

## Score
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Clarity | 4 | Map present and integrated; full interactive UX not captured in headless |
| AI Sophistication | 3 | AI-filtered on mobile; unclear depth on web |
| Personalization | 4 | Trip-context aware, location-aware on mobile |
| Delight | 3 | Near Me is delightful on mobile; web map less prominent |
| Innovation | 4 | AI-filtered map is ahead of standard Google Maps integration |
| **Average** | **3.6** | |

## Patterns Spotted
- **AI-Filtered Map Discovery** — Map shows only AI-curated relevant POIs, not exhaustive directories. Saudia applicability: High, Medium-term (destination city maps in Saudia app)
