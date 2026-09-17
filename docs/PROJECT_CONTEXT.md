# Our Sport Project Context

## Purpose

Our Sport is an Expo mobile app for finding local training partners. The first user flow collects a profile with a name, city, sport, and fitness level. The app also contains the initial UI surfaces for matching, chats, events, and the user's profile.

## Repository layout

```text
/
  oursport/       Expo 57 mobile app
  server/         TypeScript Fastify API
  render.yaml     Render web service and PostgreSQL Blueprint
  Unterlagen/     Reference/static material
  README.md       Quick-start documentation
```

The Git repository is rooted at `C:\Entwicklung\our_sport`. The app is not a separate repository anymore.

## Mobile app

- Expo SDK `57`
- React Native `0.86`
- React `19.2.3`
- TypeScript
- AsyncStorage for the local profile cache
- API URL from `EXPO_PUBLIC_API_URL`
- Local fallback API URL: `http://127.0.0.1:10000`

The app currently tries to load and save profiles through the API. If the API is unavailable, it keeps using AsyncStorage so the UI remains usable during local development.

## API

The API lives in `server/` and uses:

- Fastify
- Drizzle ORM
- PostgreSQL
- Zod request validation
- `jose` for JWT verification
- `@fastify/cors`

Current endpoints:

```text
GET   /health
GET   /ready
GET   /v1/me
POST  /v1/profiles
PATCH /v1/me
```

`/health` checks that the process is running. `/ready` checks PostgreSQL connectivity.

## Database

The current schema contains:

- `users`: external authentication subject and internal UUID
- `profiles`: name, city, sport, level, optional birth date, bio, and coordinates

Schema source: `server/src/db/schema.ts`

Initial migration: `server/drizzle/0000_initial.sql`

Migration command:

```powershell
Set-Location server
npm run db:migrate
```

The database is not required for `/health`, but it is required for profile endpoints and `/ready`.

## Authentication state

Production expects a bearer JWT and `AUTH_JWT_SECRET`. The JWT subject is stored as `users.auth_subject`.

In non-production mode, the app sends a generated UUID in `X-User-Id`. This is a development bridge only. There is not yet a real sign-in or phone/email verification flow.

## Local commands

Start the mobile web app:

```powershell
Set-Location oursport
npm run web
```

Type-check the mobile app:

```powershell
Set-Location oursport
node .\node_modules\typescript\bin\tsc --noEmit
```

Build the API:

```powershell
Set-Location server
npm run build
```

Start the API:

```powershell
Set-Location server
npm start
```

## Validation baseline

The API build and Expo TypeScript check pass. Without a local PostgreSQL instance, `/health` returns `200` and `/ready` returns `503` as expected.

## Important conventions

- Keep the API stateless; do not rely on Render's local filesystem or process memory for persistent data.
- Store photos in object storage, not PostgreSQL.
- Keep database changes in Drizzle schema plus a migration.
- Keep secrets in environment variables; never commit `.env` files.
- Read the Expo 57 documentation before changing Expo-specific code. See `oursport/AGENTS.md`.

## Next product slices

1. Choose and integrate the production identity provider.
2. Add discover profiles, swipes, and mutual matches.
3. Add conversations and messages.
4. Add events and event membership.
5. Add blocks, reports, rate limits, and privacy/data deletion flows.
