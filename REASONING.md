# Reasoning and solution approach

## Problem interpretation

The assignment is a loyalty counter for a café chain. A staff member needs to:
- register a member by phone number
- look up the member quickly
- apply points for purchase value
- redeem free rewards only when enough points exist
- keep the live tier and balance accurate at all times

There are also twists:
- a Platinum tier is introduced using lifetime points
- points expire after 90 days
- tier-upgrade notifications are queued in an outbox

## Architecture decisions

I used a lightweight full-stack pattern with Express and SQLite because it fits the scope of a real-world counter without extra infrastructure complexity. The database stores member state and events, and the API reads from that state every time instead of depending on stale frontend values.

This ensures that the balance always reflects the current business rules rather than a cached number on the client.

## Tier logic

The app uses lifetime points for tier checks. The rules are:
- Silver: default tier at low lifetime point totals
- Gold: once lifetime points reach 500
- Platinum: once lifetime points reach 5000

The point award rate follows the same tier logic:
- Silver: 1 point per ₹100
- Gold: 2 points per ₹100
- Platinum: 0.3 points per ₹

This means tier and multiplier are derived from the same data source, which reduces mismatch risk.

## Data model

The main idea is to keep point movements explainable and auditable.

- members stores the current balance and lifetime points
- point_ledger records points earned and the remaining valid points after an expiration event
- outbox stores notification records when a member crosses a tier threshold

This is important because the assignment emphasises exact balance correctness under twist conditions.

## API design

I designed APIs around real staff operations rather than generic CRUD. The key operations are:
- register member
- lookup by phone
- earn points for purchase
- redeem points for a reward
- trigger expiry clock
- view outbox notifications

This keeps the UI thin and the backend authoritative.

## UI design

The front-end includes:
- landing page describing purpose and audience
- staff login and registration
- dashboard for member actions
- member directory with search and pagination
- active member card showing balance and tier

The interface is intentionally simple so a café staff member can perform actions quickly during a busy shift.

## Testing and fixes

I tested the critical cases by running the server and hitting the endpoints directly:
- duplicate phone registration is rejected
- member lookup succeeds for the exact stored phone number
- purchase earning updates points and tier correctly
- reward redemption validates available balance before reducing points
- a future timestamp on /clock triggers expiry logic
- outbox receives a tier-upgrade event when the member crosses a threshold

During implementation, the biggest issues were:
- inconsistent phone normalization
- database migration issues around new columns
- incorrect tier thresholds during earlier iterations

Those were fixed by normalizing phone numbers before lookup and registration, enforcing a stable migration path for SQLite, and centralizing tier logic to a single function.

## Final outcome

The app now behaves like a realistic café rewards counter, and the logic is consistent with the business story and the assignment twists. The result is a product that is practical for staff use and sound enough to be evaluated for real-world problem-solving.
