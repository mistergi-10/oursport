# Render Deployment

## Services

The root `render.yaml` defines:

- `oursport-api`: Node web service rooted at `server/`
- `oursport-db`: managed PostgreSQL database

The API uses the database connection string injected by Render as `DATABASE_URL`.

## Blueprint deployment

1. Push the repository to the Git provider used by Render.
2. Create a new Render Blueprint from the repository.
3. Review the generated web service and PostgreSQL plan.
4. Set the required secret environment variables.
5. Deploy the Blueprint.

The API build command is:

```text
npm ci && npm run build
```

The migration command runs before deployment:

```text
npm run db:migrate
```

The start command is:

```text
npm start
```

Render health checks:

```text
GET /health
```

Use `/ready` to verify that the API can reach PostgreSQL after deployment.

## Required environment variables

Set these in the Render web service:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Injected | PostgreSQL connection string from `oursport-db` |
| `NODE_ENV` | Yes | Set to `production` |
| `DATABASE_SSL` | Yes | Set to `true` for Render PostgreSQL |
| `AUTH_JWT_SECRET` | Yes before real auth | Secret used to verify bearer JWTs |
| `CORS_ORIGIN` | Recommended | Comma-separated allowed app/web origins |
| `DATABASE_POOL_MAX` | Optional | PostgreSQL pool size; defaults to `10` |

The mobile app needs its own build-time variable:

```text
EXPO_PUBLIC_API_URL=https://<render-service>.onrender.com
```

Do not put `AUTH_JWT_SECRET` or database credentials in the Expo app.

## Database migration workflow

For a schema change:

1. Update `server/src/db/schema.ts`.
2. Generate a migration with `npm run db:generate`.
3. Review the generated SQL.
4. Build the API locally with `npm run build`.
5. Commit the schema and migration together.
6. Render applies migrations during deployment.

Never edit production tables manually unless there is an incident requiring a documented emergency operation.

## Local database

The API can run locally against any PostgreSQL database by setting `DATABASE_URL` in the shell before migration and startup:

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/oursport"
Set-Location server
npm run db:migrate
npm run build
npm start
```

Without `DATABASE_URL`, `/health` still works but database-backed endpoints and `/ready` cannot succeed.

## Current limitation

The API validates production JWTs, but the project does not yet issue or refresh tokens. Select an identity provider and implement the mobile sign-in flow before enabling production profile creation.
