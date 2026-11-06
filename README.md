# Restaurant Reservation Odyssey API

Express REST API for the restaurant reservation project. It uses MongoDB Atlas collection validators and indexes. Identity, restaurant management, and admin reservation listing are implemented. Reservation and waitlist routes are assigned in [PLAN.md](PLAN.md).

## Requirements

- Node.js 22 or newer
- npm
- MongoDB Atlas cluster and a database user with read/write and collection creation permissions

## Run locally

```sh
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

Replace `MONGODB_URI` in `.env` with your Atlas connection string and set `MONGODB_DB_NAME` if needed. In Atlas, allow your development IP address in Network Access. If the password contains reserved URI characters such as `@` or `/`, URL-encode it. Keep `.env` private.

Check `GET http://localhost:3000/health` for process health and `GET http://localhost:3000/health/ready` for database readiness. The API accepts and returns JSON. Import [the Member A Postman collection](postman/member-a.postman_collection.json) for request examples.

For the Postman runner, run the **1. Register user** folder once. Then, in this project's terminal, run `npm run admin:grant -- ada@example.com` (or the email set in the collection). The command requires access to the same Atlas database. Next run only the **2. Admin workflow** folder; its Login request obtains a new token and checks for the admin role before sending admin requests. Running the whole collection without the promotion cannot pass because public registration always creates a normal user. Keep tokens private.

Use HTTPS when deploying the API so passwords and bearer tokens are encrypted in transit. The local HTTP URL is for development only.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with automatic reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled API |
| `npm run typecheck` | Check types without emitting files |
| `npm run db:setup` | Create collections, validators, and indexes in Atlas |
| `npm run admin:grant -- email@example.com` | Promote an existing account to admin |
| `npm test` | Run compiled unit tests after `npm run build` |

The setup command creates missing collections and ensures indexes exist. It only sets validators when it creates a collection; changing an existing validator requires separate database administration privileges. Coordinate validator changes with your teammate. Application code must also validate input and check referenced IDs because MongoDB does not enforce foreign keys. The Atlas cluster must support transactions for atomic reservation and waitlist operations.

## Project layout

```text
src/           Express application, features, configuration, and MongoDB client
scripts/       Atlas collection and index setup
docs/          API contract for feature work
postman/       Request examples for Member A
PLAN.md        Two-member delivery plan and requirement coverage
```
