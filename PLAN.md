# Two-member implementation plan

The starter project and database schema are in place. Build features in the order below, then test the complete API with Postman. Use short pull requests and review each other's work before merging.

## Shared first step (both members)

1. Review the business rules recorded in [the API contract](docs/api-contract.md): four seats per table by default, up to three tables per booking, strict waitlist order, and Bangkok local time.
2. Run the setup in [README.md](README.md), create the Atlas collections and indexes, and confirm both health endpoints.
3. Keep route handlers thin and put database work in feature modules. Use the shared error format and validation rules.

## Member A — identity, restaurants, admin query

1. Implement registration, login, logout, password hashing, token/session revocation, and authentication/role middleware. Public registration must not accept an admin role. Cover requirements 1–2 and security.
2. Implement public restaurant list/details and admin restaurant create/update/delete, including name, address, telephone, opening/closing time, and total table capacity. Cover requirement 3 and Odyssey restaurant management.
3. Implement admin reservation list with pagination, date/status/restaurant filters, allowlisted sorting, and admin-only access. Cover requirement 7 and Odyssey query requirements.
4. Add a safe admin provisioning command and Postman examples/tests for owned endpoints. Share the auth middleware interface with Member B early.

**Main ownership:** `src/features/auth/`, `src/features/restaurants/`, `src/features/admin/`, auth middleware, and related collection indexes. Avoid editing Member B's feature modules.

## Member B — bookings, history, waitlist

1. Implement reservation create/list/detail/edit/cancel using authenticated user identity and owner/admin authorization. Enforce capacity atomically and the agreed 3-table policy. Cover requirements 3–6 and 8–9.
2. Implement own reservation history with past/upcoming/cancelled/completed filters. Define how confirmed past bookings become completed. Cover Odyssey history requirement.
3. Implement full-slot waitlist join/list/leave, FIFO offers on capacity release, offer expiry, and acceptance. Keep offer and capacity transitions transactional. Cover Odyssey waitlist requirement.
4. Add integration tests for double booking, concurrent booking, ownership, admin overrides, and waitlist order. Add Postman examples/tests for owned endpoints.

**Main ownership:** `src/features/reservations/`, `src/features/waitlist/`, and related collection indexes. Reuse Member A's auth middleware and restaurant model.

## Integration and acceptance (both members)

1. Connect feature routers in `src/app.ts` after each side passes its own tests; coordinate collection validator/index changes in `scripts/setup-db.ts`.
2. Run build, integration tests, and a Postman collection against Atlas. Verify that a normal user cannot read or change someone else's reservation and cannot use admin routes.
3. Check the 3-second target with a small realistic dataset and indexed queries; measure response time rather than assuming it. Do not claim a production guarantee from local tests.
4. Confirm all nine core requirements plus the four Odyssey additions. Review error responses, input validation, credentials handling, and setup instructions.
