# Restaurant Reservation Odyssey API

Backend starter for the restaurant reservation project. It provides an Express REST API, MongoDB Atlas collection validators and indexes, and health endpoints. Feature endpoints are assigned in [PLAN.md](PLAN.md) and are not implemented yet.

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

Check `GET http://localhost:3000/health` for process health and `GET http://localhost:3000/health/ready` for database readiness. The API accepts and returns JSON. Use Postman to call endpoints as they are implemented.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with automatic reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled API |
| `npm run typecheck` | Check types without emitting files |
| `npm run db:setup` | Create collections, validators, and indexes in Atlas |

The setup command is safe to rerun for index creation. It only creates collection validators when a collection does not already exist; coordinate later validator changes with your teammate. Application code must also validate input and check referenced IDs because MongoDB does not enforce foreign keys. The Atlas cluster must support transactions for atomic reservation and waitlist operations.

## Project layout

```text
src/           Express application, configuration, and database pool
scripts/       Atlas collection and index setup
docs/          API contract for feature work
PLAN.md        Two-member delivery plan and requirement coverage
```
