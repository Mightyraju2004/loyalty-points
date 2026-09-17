# CaféRewards Loyalty Counter

A full-stack loyalty management system for café staff to register members, calculate live balances, award points on purchases, and redeem rewards while maintaining correct tiers and lookup behaviour.

## Why this product

The app is aimed at café chains and regular customer loyalty programs. Staff can look up members by phone number, add points to a bill, redeem rewards, and always see the member's accurate live balance and tier status.

## Features

- Staff registration and login
- Member registration with unique phone lookup key
- Live points balance and tier status
- Silver / Gold / Platinum tier logic using cumulative lifetime points
- One-step purchase earning flow
- Reward redemption with strict balance validation
- Search, sorting, and pagination in the member directory
- One-page landing page for product overview and next features
- SQLite-backed persistence for reliable state across requests
- Bonus twist support for 90-day point expiry and tier-upgrade notifications

## Tech stack

- Node.js
- Express.js
- SQLite3
- Vanilla HTML, CSS, and JavaScript

## Setup and run

1. Install dependencies:
   npm install
2. Start the app:
   npm start
3. Open the app in a browser:
   http://localhost:3000

Optional: if you need a clean database reset for local testing:
- stop the server
- delete database.db
- restart the app

## User flow

1. Register a staff account.
2. Login to the POS dashboard.
3. Add a new member with name and phone number.
4. Search by phone number to load the member.
5. Enter a purchase amount to award points.
6. Redeem a reward when the member has enough balance.
7. Refresh the member list and active card to verify live balance updates.

## API endpoints

### Authentication
- POST /api/register
  - Body: { name, email, password }
- POST /api/login
  - Body: { email, password }

### Members
- POST /api/members
  - Body: { name, phone, email }
- GET /api/members
  - Query: search, page, limit
- GET /api/members/lookup
  - Query: phone

### Transactions
- POST /api/transactions/earn
  - Body: { phone, billAmount }
- POST /api/transactions/redeem
  - Body: { phone, cost }

### Twist features
- POST /clock
  - Body: { current_time }
  - Applies 90-day point expiry logic
- GET /outbox
  - Returns tier-upgrade notification events

## Database schema

The app uses SQLite with these tables:
- members
- point_ledger
- outbox

This gives real persistence and supports the loyalty logic, expiration clock, and notification flow.

## Landing page and UI

The front-end is served from the public folder and includes:
- a product landing page with overview, audience, and future features
- a dashboard for staff actions
- member directory with search and pagination

## Debugging notes

- Start with npm start and check the server logs
- Confirm the browser loads http://localhost:3000/dashboard.html
- If a lookup fails, confirm the phone format and the member record in SQLite
- If tiers are wrong, check lifetime_points and the tier logic in the server
- To test expiry, send a POST request to /clock with a future timestamp

## Evaluation checklist

This project includes the required deliverables:
- database persistence
- REST APIs
- usable UI
- user login and registration
- search
- landing page
- pagination and sorting
- README, REASONING, and AI_LOGS files
