// Real metrics transcribed from the operator's dashboards (Stripe, the Nubio
// product-analytics dashboard, and Google Analytics). Used to ground the assistant's
// "morning briefing" so the spoken numbers are accurate rather than invented.
//
// The product is referred to generically as "your app" — no brand name.

// Note: the UI-side list of "sources" (the tab chips shown during the briefing)
// lives in the renderer at src/renderer/src/lib/briefing-sources.ts, since it is
// pure display data. This module is main-process only and holds the facts that
// ground the spoken briefing.

export const BRIEFING_FACTS = `# Your app — current metrics

## Stripe (revenue, last 12 months)
- Gross volume: $1,611.45 (up from $0 the previous period — first full year of revenue)
- Net volume: $1,421.33
- MRR (monthly recurring revenue): $148.00, trending steadily upward all year
- Payments succeeded: $1,542.48
- Payments failed: $90.96 (roughly 5.6% of gross volume — notable leakage)
- Payments refunded: $68.97
- Payments blocked: $33.99
- New customers: 1,937
- Recent failed payments were $15.00 charges (the standard plan price)

## Nubio (product analytics)
- Total registered users: 3,577
- Monthly signups: December 220, January 390, February 340, March 270, April 310, May 360
- Signups dipped in March then recovered; May is the second-strongest month
- Daily growth in May averaged roughly 8 to 18 new users, with a spike to ~39 on May 20th

## Google Analytics (acquisition & engagement)
- Active users: 4,100
- New users: 8,100
- Average engagement time: 1 minute 19 seconds
- Event count: 56,000
- Traffic by first-touch source/medium:
  - direct: 1,400
  - google / cpc (paid search): 1,100
  - reddit.com / referral: 546
  - google / organic: 529
  - instagram / paid: 118
  - threads / referral: 116
  - twitter (t.co) / referral: 92
- Top pages by views and bounce rate:
  - Main app: 7,700 views, 13.3% bounce — healthy
  - Organize: 5,600 views, 66.6% bounce — high
  - "Not Available in Your Region": 2,100 views, 84.8% bounce — a large slice of traffic is being geo-blocked and lost
  - Welcome page: 732 views, 4.3% bounce — excellent
  - 2D to 3D Floor Plan: 776 views, 38.3% bounce
  - AI Image Similarity Tool: 708 views, 36.0% bounce

## Notable signals worth surfacing
- "Not Available in Your Region" is the third most-viewed page with an 84.8% bounce rate — meaningful demand is being turned away at the door.
- Paid search (google/cpc, 1,100) outweighs organic search (529) — acquisition leans heavily on ad spend.
- Reddit referral (546) is a strong, free community channel performing nearly as well as paid.
- MRR is only $148 against 3,577 users — monetisation/conversion is the clear lever.
- ~5.6% of payment volume is failing — recoverable revenue with retries/dunning.`;
