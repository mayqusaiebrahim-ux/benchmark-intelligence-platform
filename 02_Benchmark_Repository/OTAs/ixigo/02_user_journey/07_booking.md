# 07 Booking — ixigo
**Step Score:** 3.6 / 5.0 | **Innovation Score:** 3.5 / 5.0

---

## What I Saw

ixigo's booking flow was observed for trains (most feature-rich on web) and partially for flights and buses. Full booking flows require login and go through IRCTC for train tickets — ixigo acts as an authorized IRCTC agent.

Key observations:

### Train Booking Flow
- Multi-class selection with real-time availability signals
- **Quota-aware booking**: selecting quota changes the available seats shown
- Tatkal booking shows premium pricing + AI-driven timing recommendation (when Tatkal opens, whether current availability will last)
- Waitlist management: IRCTC waitlist number shown alongside the PNR prediction probability
- Passenger details prefill (if logged in via Google/Facebook)
- IRCTC authorization step built into ixigo flow — seamless vs. direct IRCTC (which is notorious for poor UX)

### Multi-Modal Breadth
Flights, Hotels, Trains, Buses, and Cabs all bookable within ixigo. This is one of the strongest multi-modal booking platforms in this benchmark cycle. Trip.com has comparable breadth; Mindtrip has zero native booking.

### ixigo as IRCTC Abstraction Layer
The most innovative booking aspect: ixigo wraps the notoriously complex and crash-prone IRCTC booking interface with a clean, modern UX layer. This is **UX arbitrage** — taking a high-demand utility with poor UI and making it delightful.

### Booking Flow Length
Not fully captured (require login and live IRCTC session), but by observation: 3-4 steps for trains (search → train selection → passenger details → payment). This is comparable to best-in-class flight booking.

---

## The 5 Questions

### 1. What is happening here?
ixigo's booking is dominated by its IRCTC authorization — which is both its competitive moat (direct IRCTC agent status is limited) and its strongest product position. For trains, ixigo has built the best booking UX on top of government rail infrastructure.

### 2. Why is this valuable from a UX perspective?
IRCTC's native website crashes during Tatkal rush hours, has CAPTCHA-heavy flows, and requires mandatory registration. ixigo eliminates all of this. The booking experience is clean, fast, and reliable. For 20 million monthly train bookers, this is the difference between succeeding and failing at the transaction.

### 3. What trend does it represent?
**Licensed abstraction layers**: the model of becoming an authorized agent for government/legacy infrastructure and building a superior UX on top. This is structurally analogous to how Amadeus/Sabre work for airlines — but applied at the consumer UX layer, not just the data layer.

### 4. How could this evolve?
AI pre-booking advisor: before completing the Tatkal booking, ixigo AI says "Tatkal on this route has confirmed 94% of waitlist tickets in the past 30 days. But the 08:15 train has 6 available confirmed seats right now. Do you want confirmed now or Tatkal later?" This turns the booking step into an AI-guided decision.

### 5. What opportunity does this create for Saudia?
Saudia's direct booking advantage is analogous to ixigo's IRCTC authorization: Saudia owns the inventory, nobody else can give the customer a better deal or a more reliable booking on Saudia flights. The lesson from ixigo: **the moat is only valuable if the UX is better than the alternative.** Saudia must ensure that booking through saudia.com is meaningfully better (not just equal to) booking through OTAs. AI pre-booking advisor for Saudia: "This flight is 67% full. Seat 12A is the last window seat in rows 10–15. Hold it now?"

---

## Score
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Clarity | 4.0 | Clean booking steps; much better than IRCTC native |
| AI Sophistication | 3.5 | Waitlist + PNR prediction accessible during booking |
| Personalization | 3.0 | Prefill if logged in; quota context from search |
| Delight | 3.5 | Relief of IRCTC abstraction layer = significant delight |
| Innovation | 3.5 | IRCTC abstraction + multi-modal breadth + AI-adjacent booking signals |
| **Step Average** | **3.6** | |
