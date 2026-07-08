# 11 Check-in — ixigo
**Step Score:** 2.0 / 5.0 | **Innovation Score:** 2.0 / 5.0

---

## What I Saw

Web check-in URL (`/flights/web-check-in`) returned 404. This feature may be app-only or was not accessible at the time of benchmarking.

For trains, there is no traditional "check-in" concept — the ticket (physical or digital) is the boarding document. However, ixigo's PNR confirmation system serves a functional equivalent: it tells you whether your ticket is valid for travel before you get to the station.

The train ticket → boarding pass workflow is handled entirely within the PNR system:
- PNR confirmation = authorization to travel
- Coach + seat number from PNR = boarding assignment
- Platform locator = boarding gate analog

This is a de facto check-in flow — compressed into the PNR Status tool and Coach Position tool.

---

## The 5 Questions

### 1. What is happening here?
Web check-in for flights is not available. Train check-in is implicit (PNR-based) but functions as a complete boarding preparation system. The overall check-in experience is below the innovation threshold for the flight vertical.

### 2. Why does this matter?
Web check-in is table stakes for airlines. For ixigo's OTA model, the absence on web means passengers are pushed to: (1) the app, (2) the airline's own website. This breaks the booking journey and creates a referral gap.

### 3. What trend does it represent?
App-first product strategy: ixigo treats the web as a search and conversion surface; post-booking experience lives in the app. This is a common Indian tech company pattern but diverges from global OTA trends where web and app parity is expected.

### 4. How could this evolve?
Unified boarding hub: one screen in the app (or web) that aggregates check-in status for all legs (flight + train connection + final bus/cab). AI alerts when each check-in window opens and pre-fills all required information from the user's profile.

### 5. What opportunity does this create for Saudia?
The train PNR analog for Saudia is the **24-hour pre-departure briefing**: a structured push notification or app screen that replaces the generic "check in now" email with a personalized briefing: seat number, upgrade status, lounge access, gate assignment, weather at destination, baggage policy reminder. Saudia owns all this data and can deliver it at precisely the right moment.

---

## Score
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Clarity | 2.5 | N/A for web; train PNR system is clear |
| AI Sophistication | 1.5 | No AI in check-in; PNR is functional not generative |
| Personalization | 2.0 | PNR-specific only |
| Delight | 2.0 | Below expectation for flight web check-in |
| Innovation | 2.0 | Below Innovation Filter threshold |
| **Step Average** | **2.0** | |

**Note:** Web check-in feature not present (404). Train PNR system partially substitutes. App experience not captured in this benchmark.
