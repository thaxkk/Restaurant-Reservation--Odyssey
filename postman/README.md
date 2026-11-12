# Postman / Newman — Member B

`member-b.postman_collection.json` exercises the reservations, history, and
waitlist endpoints (requirements 3-6, 8-9, 12-13), including the invalid-input
checks for the create-booking demo step.

## Prerequisites

The collection calls Member A's auth and restaurant endpoints to log in and seed
a restaurant, so run it against the **integrated** app (Member B merged with
`feature/auth-restaurants-admin`), not this branch alone.

1. API running against an Atlas cluster that supports transactions.
2. `npm run db:setup` has been run.
3. An admin account exists: register `ada@example.com`, then
   `npm run admin:grant -- ada@example.com` (Member A's command).

## Run

```sh
# one-off, no install
npx newman run postman/member-b.postman_collection.json

# override any variable, e.g. a different base URL or admin password
npx newman run postman/member-b.postman_collection.json \
  --env-var baseUrl=http://localhost:3000 \
  --env-var adminPassword=your-admin-password
```

Run the folders in order (top to bottom) — later folders reuse tokens and ids
captured by earlier requests. In Postman's Collection Runner this is the default;
Newman also preserves order.

## What it checks

- **Create booking** (demo 4) + invalid conditions: >3 tables, past date, missing
  fields, unknown restaurant.
- **View own booking** (demo 5) + 401 when unauthenticated.
- **Edit own booking** (demo 6).
- **Ownership guard**: another user gets 403 on view/edit.
- **Admin on any booking** (demo 10-12): admin can view and edit.
- **Delete booking** (demo 7) = cancel; the row is retained with
  `status: cancelled` and still appears in history (requirement 13).
- **Waitlist** (extra credit, requirement 12): a 1-table restaurant is filled,
  a second user is blocked (`409 SLOT_FULL`), joins the waitlist, the booking is
  cancelled, the waiting entry is promoted to `offered`, and the second user
  accepts to get a confirmed reservation.
