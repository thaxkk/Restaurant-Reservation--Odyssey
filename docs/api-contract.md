# API contract

All routes below are implemented. JSON is used for requests and responses. IDs are MongoDB ObjectId strings. Protected routes use `Authorization: Bearer <token>`. Dates use `YYYY-MM-DD`, times use `HH:mm` in the restaurant's local time. The initial project assumes all restaurants use `Asia/Bangkok`; make timezone explicit before supporting other regions.

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

Restaurant create body: `{ "name": "Odyssey", "address": "Bangkok", "telephone": "021234567", "opensAt": "10:00", "closesAt": "22:00", "totalTables": 20, "seatsPerTable": 4 }`. `seatsPerTable` defaults to 4 when omitted, including on existing restaurant records. PATCH accepts any nonempty subset. A capacity decrease returns `409` if it would invalidate an existing booking or active waitlist request; a table-capacity increase offers freed slots to waiting users. DELETE returns `409` while future confirmed bookings or active waitlist entries exist. Otherwise it hides the restaurant from public discovery while preserving reservation history; new bookings for deleted restaurants are rejected.

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

Each reservation and waitlist request must have `tablesRequested <= totalTables` and `partySize <= tablesRequested * seatsPerTable`. At most three tables can be requested per booking. `GET /api/reservations?when=past` or `when=upcoming` filters by date and time; `status` can also be supplied and remains independent, so past cancelled reservations can be queried. Past confirmed reservations are marked completed when history or the admin list is read.

## Shared conventions

- Success: standard HTTP codes (`200`, `201`, `204`). Errors: `{ "error": { "code": "...", "message": "..." } }`.
- Validation errors return `400`; missing/invalid authentication `401`; insufficient role or ownership `403`; missing record `404`; capacity and duplicate conflicts `409`.
- Login identity is **email**, matching the functional requirement. The nonfunctional slide says username/password; this project treats email as the username.
- Passwords are stored only as strong password hashes. Admin accounts must be provisioned separately; public registration always creates `user` role.
- Pagination for admin reservations: `page` (starting at 1), `limit` (maximum 100), `date`, `status`, `restaurantId`, `restaurantName`, `sortBy` (`date` or `createdAt`), `order` (`asc` or `desc`). Response includes `items`, `page`, `limit`, and `total`.
- Member B can import `requireAuth`, `requireAdmin`, and `getAuth` from `src/features/auth/middleware.ts`. `getAuth(res)` returns `userId` as an ObjectId, `role`, `email`, and `sessionId`.
- All reservation and waitlist availability changes occur inside a MongoDB transaction. The matching `reservation_slots` guard document makes concurrent changes conflict and retry safely. Active waitlist entries prevent direct bookings from taking their slot. Cancellation releases capacity and offers it to the first waiting entry; a later entry is never offered ahead of one that needs more tables. Offers expire after 15 minutes; the server processes expired offers every minute, and acceptance rechecks capacity.
- Reservation `status` is `confirmed`, `cancelled`, or `completed`. Waitlist `status` is `waiting`, `offered`, `accepted`, `expired`, or `cancelled`.

The system treats each `HH:mm` value as a distinct slot and permits overnight opening hours. The three-table limit applies **per booking**. Review these assumptions before extending the system to different timezones or seating layouts.
