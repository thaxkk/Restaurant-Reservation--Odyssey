# API contract

Member A routes and both health routes are implemented. Member B routes remain planned. JSON is used for requests and responses. IDs are MongoDB ObjectId strings. Protected routes use `Authorization: Bearer <token>`. Dates use `YYYY-MM-DD`, times use `HH:mm` in the restaurant's local time. The initial project assumes all restaurants use `Asia/Bangkok`; make timezone explicit before supporting other regions.

## Auth and restaurants (Member A)

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Create user with name, telephone, email, password |
| POST | `/api/auth/login` | Public | Exchange email and password for token |
| POST | `/api/auth/logout` | User | Revoke current session/token |
| GET | `/api/restaurants` | Public | List restaurants |
| GET | `/api/restaurants/:id` | Public | Restaurant details |
| POST | `/api/restaurants` | Admin | Create restaurant and total table capacity |
| PATCH | `/api/restaurants/:id` | Admin | Update restaurant profile |
| DELETE | `/api/restaurants/:id` | Admin | Delete restaurant profile, subject to reservation history policy |
| GET | `/api/admin/reservations` | Admin | Page, filter, and sort all reservations |

Registration body: `{ "name": "Ada", "telephone": "0812345678", "email": "ada@example.com", "password": "at-least-8-chars" }`. Registration always returns a normal user account. Login takes `email` and `password` and returns a bearer token valid for seven days. Logout revokes that token immediately.

Restaurant create body: `{ "name": "Odyssey", "address": "Bangkok", "telephone": "021234567", "opensAt": "10:00", "closesAt": "22:00", "totalTables": 20 }`. PATCH accepts any nonempty subset. DELETE hides the restaurant from public discovery while preserving reservation history; Member B must reject new bookings for restaurants with `deletedAt`.

`GET /api/restaurants` returns `{ items, page, limit, total }` with `page` starting at 1 and `limit` capped at 100. `GET /api/admin/reservations` uses the filters and sort parameters below. Admin accounts are promoted from an existing registered account with `npm run admin:grant -- admin@example.com`; public registration cannot grant admin access.

## Reservations and waitlist (Member B)

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/reservations` | User | Create reservation or report full slot |
| GET | `/api/reservations` | User | Own reservation history, with status/date filters |
| GET | `/api/reservations/:id` | Owner or admin | View reservation |
| PATCH | `/api/reservations/:id` | Owner or admin | Edit reservation and recheck capacity |
| DELETE | `/api/reservations/:id` | Owner or admin | Cancel reservation; retain history |
| POST | `/api/waitlist` | User | Join a full slot's FIFO queue |
| GET | `/api/waitlist` | User | View own waitlist entries and offers |
| POST | `/api/waitlist/:id/accept` | Owner | Accept an available offer |
| DELETE | `/api/waitlist/:id` | Owner | Leave waitlist |

## Shared conventions

- Success: standard HTTP codes (`200`, `201`, `204`). Errors: `{ "error": { "code": "...", "message": "..." } }`.
- Validation errors return `400`; missing/invalid authentication `401`; insufficient role or ownership `403`; missing record `404`; capacity and duplicate conflicts `409`.
- Login identity is **email**, matching the functional requirement. The nonfunctional slide says username/password; this project treats email as the username.
- Passwords are stored only as strong password hashes. Admin accounts must be provisioned separately; public registration always creates `user` role.
- Pagination for admin reservations: `page` (starting at 1), `limit` (maximum 100), `date`, `status`, `restaurantId`, `restaurantName`, `sortBy` (`date` or `createdAt`), `order` (`asc` or `desc`). Response includes `items`, `page`, `limit`, and `total`.
- Member B can import `requireAuth`, `requireAdmin`, and `getAuth` from `src/features/auth/middleware.ts`. `getAuth(res)` returns `userId` as an ObjectId, `role`, `email`, and `sessionId`.
- All reservation and waitlist availability changes must occur inside a MongoDB transaction. Update the matching `reservation_slots` guard document in each transaction so concurrent bookings conflict and retry safely. Cancellation releases capacity and promotes the earliest eligible waitlist entry. An offer must have an expiration time, and acceptance must recheck capacity.
- Reservation `status` is `confirmed`, `cancelled`, or `completed`. Waitlist `status` is `waiting`, `offered`, `accepted`, `expired`, or `cancelled`.

Before feature coding, the team should agree on slot length, opening-hours treatment for overnight hours, how many seats one table represents, and whether “up to 3 tables” limits tables per booking or total active bookings per user. The schema currently supports 1–3 tables **per booking**.
