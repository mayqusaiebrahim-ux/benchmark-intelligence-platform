# 03 Search — ixigo
**Step Score:** 3.6 / 5.0 | **Innovation Score:** 3.8 / 5.0

---

## What I Saw

ixigo's search capability is strongest in the **trains vertical** and adequate in flights, hotels, and buses. The train search experience is significantly richer than any Western OTA's flight search form.

### Trains Search
The trains search form offers:
- **Origin → Destination** with IRCTC station codes (autocomplete)
- **Date picker**
- **Quota selector**: General / Tatkal / Premium Tatkal / Ladies / Senior Citizen / Differently Abled / Foreign Tourist — each quota is a different AI-accessible inventory pool
- **Journey Class**: Sleeper / AC Tiers (3A, 2A, 1A) / Chair Car / Second Sitting
- **Train-specific utilities directly accessible from search results**:
  - Live Running Status
  - Seat Availability (real-time)
  - PNR Status
  - Coach Position

This is **multi-dimensional search** — the user is not just searching for a route; they are searching within a specific quota, class, and can immediately access AI prediction tools from the results.

### Flights Search
Standard. Multi-city. Round-trip/One-way/Multi-City tabs. The Special Fares selector (Student/Senior/Armed Forces) is the key differentiator from generic OTA flight search.

**Note:** Flight results URL format returned 404 during benchmarking — likely requires a specific format that differs from what was tested. Flight search results AI features were not capturable.

### Multi-Modal Breadth
ixigo offers search across: Flights + Trains + Hotels + Buses + Cabs + Visa. This is the broadest multi-modal coverage in the benchmark cycle so far, matching Trip.com.

---

## The 5 Questions

### 1. What is happening here?
ixigo search for trains is genuinely sophisticated — it is not a simple form. The quota system exposes a complex underlying inventory model that requires AI to navigate efficiently (which quotas have availability? which Tatkal bookings will confirm?). Flight search is standard. Multi-modal coverage is best-in-class.

### 2. Why is this valuable from a UX perspective?
The quota selector is a UX innovation specific to Indian rail: by making quota selection visible and accessible, ixigo gives users control over an inventory dimension that most booking systems hide. Tatkal (last-minute premium) and Senior Citizen quotas have meaningfully different availability — exposing this at search time is a significant usability improvement over generic rail booking.

### 3. What trend does it represent?
**Domain-specific search depth**: building search that is specifically adapted to the complexity of a domain rather than applying a generic form template. This is the opposite of Mindtrip's approach (reduce search to conversation) — ixigo surfaces complexity and makes it manageable, rather than abstracting it away.

### 4. How could this evolve?
AI quota advisor: "Based on your travel date and route, Tatkal has a 85% availability probability. General has a 22% confirmation probability. AI recommends: book Tatkal now." This turns the quota selector from a manual choice into an AI recommendation.

### 5. What opportunity does this create for Saudia?
The class/quota model has a direct analog in airline search: Economy / Business / First / Upgrade Bid / Upgrade Waitlist. Saudia could create a **Class Intelligence** feature: when the user selects Business class, show the upgrade probability if they book Economy instead and join the waitlist. AI makes the fare class decision a predictive one rather than a binary choice.

---

## Score
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Clarity | 3.8 | Train search is clear despite complexity; flight search is standard |
| AI Sophistication | 3.5 | AI is accessible from search results (PNR, running status); quota system shows domain depth |
| Personalization | 2.5 | No login-based personalization in search |
| Delight | 3.0 | Functional; quota selector is empowering rather than delightful |
| Innovation | 4.0 | Quota-aware search + multi-modal breadth + AI accessible from results |
| **Step Average** | **3.6** | |
