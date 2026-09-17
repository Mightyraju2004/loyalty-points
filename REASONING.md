
# Reasoning and Solution Approach (`REASONING.md`)

## Problem Interpretation

The assignment requires implementing a robust Café Loyalty Program backend and POS dashboard. Café staff require a reliable system to:
- Onboard new members using unique phone numbers.
- Look up existing members instantly via search queries.
- Award points dynamically calculated from transaction bill values and active status tiers.
- Redeem reward vouchers with strict, server-enforced balance validation.
- Maintain transparent, real-time balance calculations and tier badges across all UI elements.

In addition to core features, the system integrates advanced twist logic:
- A four-tier progression system (**Bronze**, **Silver**, **Gold**, and **Platinum**) driven by cumulative lifetime points.
- A 90-day point expiration ledger engine simulated via time-shift requests (`POST /clock`).
- An asynchronous event outbox (`/outbox`) to queue tier-upgrade and expiration notification events.

---

## Architectural Decisions

A single-instance **Node.js + Express.js** server paired with an embedded **SQLite3** (`database.db`) persistence layer was selected. This architecture provides several key advantages:

1. **Lightweight & High-Performance:** Eliminates external service dependencies, enabling instant local startup and zero-configuration testing.
2. **Server-Authoritative State:** All tier evaluations, balance calculations, and transaction validations are processed server-side. The frontend acts purely as a presentation layer, preventing client-side cache manipulation or stale display bugs.
3. **Transactional Audit Trails:** SQLite's file-backed ACID compliance ensures point transactions and ledger adjustments survive server restarts and process kills.

---

## Tier Logic & Multiplier Calibration

To prevent tier calculation drift, a single, centralized evaluation function (`getTierInfo`) governs all status calculations across API endpoints and directory formatters.

Tier assignments and earning multipliers strictly adhere to the following business rules:

| Tier Level | Lifetime Points Bracket | Multiplier Rate | UI Multiplier Display Badge |
| :--- | :--- | :--- | :--- |
| **Bronze** | `0` – `199` lifetime pts | `0.01` | `1x pts/₹100` |
| **Silver** | `200` – `499` lifetime pts | `0.015` | `1.5x pts/₹100` |
| **Gold** | `500` – `4,999` lifetime pts | `0.02` | `2x pts/₹100` |
| **Platinum** | `5,000+` lifetime pts | `0.3` | `0.3 pts/₹` |

### Key Logic Implementation (`server.js`):
javascript
function getTierInfo(member) {
  // Safe numeric coercion handling nullish DB fields
  const lifetime = Number(member.lifetime_points ?? member.points ?? 0);

  if (lifetime >= 5000) {
    return { tier: 'Platinum', ratePerRupee: 0.3, displayMultiplier: '0.3 pts/₹' };
  }
  if (lifetime >= 500) {
    return { tier: 'Gold', ratePerRupee: 0.02, displayMultiplier: '2x pts/₹100' };
  }
  if (lifetime >= 200) {
    return { tier: 'Silver', ratePerRupee: 0.015, displayMultiplier: '1.5x pts/₹100' };
  }

  return { tier: 'Bronze', ratePerRupee: 0.01, displayMultiplier: '1x pts/₹100' };
}
## Data Model & Schema Design

The relational database structure separates current spendable state from historical audit trails:

* **`members` Table:**
  Primary identity store containing `id`, `name`, `phone` (unique key), `email`, spendable `points`, and cumulative `lifetime_points`.
  `lifetime_points` serves as an append-only counter that never decreases upon redemption, guaranteeing tier persistence.

* **`point_ledger` Table:**
  Tracks individual point credit transactions (`points_earned`, `points_remaining`, `created_at`).
  Supports 90-day First-In-First-Out (FIFO) expiration scheduling evaluated during `POST /clock` triggers.

* **`outbox` Table:**
  Event outbox pattern store (`member_id`, `event_type`, `payload`, `created_at`).
  Decouples notification queueing (e.g., `TIER_UPGRADE`, `POINTS_EXPIRED`) from HTTP request execution.

---

## API Design & Operations

The REST API mirrors real café counter operations:

* `POST /api/register` & `POST /api/login`: Handles staff authentication.
* `POST /api/members`: Registers new customers with automated phone string normalization (`/\D/g`).
* `GET /api/members`: Returns paginated, searchable member records formatted with live tier badges.
* `POST /api/transactions/earn`: Calculates new points based on active tier rate, updates spendable balance and `lifetime_points`, and checks for tier threshold crossing.
* `POST /api/transactions/redeem`: Validates available spendable balance before deducting points.
* `POST /clock`: Simulates system time progression to process point ledger expirations.
* `GET /outbox`: Exposes queued notification events for background worker processing.

---

## Debugging Sessions, Issue Diagnosis & Resolutions

During development and testing sessions, key edge cases and boundary anomalies were identified and resolved:

### 1. Zero-Point Boundary Bug (Gold Tier Misassignment)
* **Symptom:** A newly created member with `0 points` displayed a **Gold Tier** badge (`2x pts/₹100`).
* **Root Cause:** Loose comparison operators and uncoerced string properties caused `lifetime_points` evaluations to evaluate incorrectly or fall through threshold conditions.
* **Fix:** Introduced explicit numeric coercion `Number(...)` and enforced structured step-down conditions (`>= 5000` $\rightarrow$ `>= 500` $\rightarrow$ `>= 200` $\rightarrow$ fallback to `Bronze`).

### 2. Database Persistence & Stale Cache Discrepancies
* **Symptom:** After updating tier evaluation code in `server.js`, existing test members in the browser UI still displayed stale tier badges.
* **Root Cause:** SQLite persists state directly to `database.db`. Updating application logic does not retroactively rewrite existing SQLite table rows containing historical `lifetime_points` data written during previous test runs.
* **Fix:** Established a standard database flushing protocol (`rm -f database.db loyalty.db`) prior to running boundary verification test suites.

### 3. Mid-Tier Boundary Validation (200 Point Threshold)
* **Symptom:** A member with exactly `200 points` rendered as **Gold** instead of **Silver**.
* **Root Cause:** Database rows seeded during testing contained higher historical values than displayed spendable balances.
* **Fix:** Verified that `200 lifetime_points` strictly maps to **Silver** (`1.5x pts/₹100`) and validated seeded database rows using SQL CLI scripts.

### 4. Phone Number Normalization
* **Symptom:** Lookups failed when staff entered formatted phone inputs (e.g., `(987) 654-3210` vs `9876543210`).
* **Fix:** Implemented global input sanitization using `.replace(/\D/g, '')` across registration, search, and lookup handlers.

---

## Final System State & Verification Summary

All core requirements and twist criteria are fully operational and verified:

- [x] **Relational State Persistence:** SQLite integration verified via disk persistence.
- [x] **Tier Calculation Accuracy:** Boundary cases verified across Bronze (0 pts), Silver (200 pts), Gold (500 pts), and Platinum (5000 pts).
- [x] **Data Integrity:** Strict numeric coercion prevents calculation anomalies.
- [x] **Auditability:** Complete diagnostic logs and session history captured in `AI_LOGS.md`.
