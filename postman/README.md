# Postman / Newman

## Complete runner

`full-workflow.postman_collection.json` runs the API requests in order. It creates
three fresh test users and one restaurant, checks authentication and role
guards, bookings, four seats per table, admin filters, capacity changes, FIFO
waitlist offers, cancelled history, restaurant deletion, and logout. Dates and
user emails are generated for each run. It cancels its bookings and soft-deletes
its restaurant, but test users and their history remain in the database. Use a
separate Atlas test database.

The runner needs an existing admin account in the **same database as the API**.
Register one using `POST /api/auth/register`, then run
`npm run admin:grant -- admin@example.com`. The admin password is the password
used at registration. Do not put the password in a committed collection.

Start the API, then either import the collection into Postman, set collection
variables `adminEmail` and `adminPassword`, and run the entire collection with
one iteration; or use the terminal runner:

```sh
export POSTMAN_ADMIN_EMAIL=admin@example.com
export POSTMAN_ADMIN_PASSWORD='your-admin-password'
./scripts/run-postman.sh
```

`POSTMAN_BASE_URL` overrides the default `http://localhost:3000`. The script
runs the collection with Newman. Do not run individual
requests out of order because later requests use IDs and tokens captured by
earlier ones. A completed reservation needs time to pass, so that status is
covered by the Atlas integration tests rather than this immediate runner.

## Member B collection

`member-b.postman_collection.json` exercises the reservations, history, and
waitlist endpoints (requirements 3-6, 8-9, 12-13), including the invalid-input
checks for the create-booking demo step.

## Prerequisites

The collection calls auth and restaurant endpoints to log in and seed a
restaurant, so run it against the integrated app.

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
