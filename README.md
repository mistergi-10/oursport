# oursport

Expo mobile app with a TypeScript API service.

## Documentation

- [Project context and architecture](docs/PROJECT_CONTEXT.md)
- [Render and database deployment](docs/RENDER_DEPLOYMENT.md)

## Mobile app

```powershell
Set-Location oursport
npm start
```

## API server

```powershell
Set-Location server
npm install
npm run build
npm start
```

The API exposes `GET /health` and listens on `PORT` (default `10000`).

For local development, set `DATABASE_URL` to a PostgreSQL database and run:

```powershell
Set-Location server
npm run db:migrate
npm run build
npm start
```

In non-production mode, profile requests can use a UUID in the `X-User-Id`
header. Production requests must use a bearer token and configure
`AUTH_JWT_SECRET`.

## Render and GitHub

Connect this repository to Render and use the included `render.yaml` Blueprint.
Render will provision PostgreSQL, run `npm run db:migrate`, deploy the `server`
directory as a web service, and check `/health`. Store `AUTH_JWT_SECRET`,
`CORS_ORIGIN`, and other secrets in Render environment variables rather than
committing them.
