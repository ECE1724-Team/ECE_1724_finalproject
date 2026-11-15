# Authentication backend

The backend uses the existing Express/TypeScript/`pg` stack and Better Auth 1.7.20. PostgreSQL SQL operations and `node-pg-migrate` remain the database interface; no ORM is introduced. The package is ESM, as required by Better Auth's Express integration.

## Run locally

Use Node.js 24 or later and PostgreSQL with `gen_random_uuid()` support. From this directory:

```bash
npm ci
cp .env.example .env
```

Create a dedicated development database, set `DATABASE_URL`, generate a private `BETTER_AUTH_SECRET`, and configure your SMTP server in `.env`. Keep `.env` out of git. A local SMTP catcher can replace a provider during development; the sample localhost SMTP address is not a deployed service.

Authenticated SMTP uses implicit TLS or requires STARTTLS. The unauthenticated localhost catcher can use plain SMTP; do not disable certificate validation for a provider.

```bash
npm run migrate
npm run dev
```

`GET /health` reports the HTTP service. Auth routes are under `/api/auth`. Browser clients send requests with `credentials: "include"`; do not save Session tokens in local storage. The frontend's exact origin must appear in `AUTH_TRUSTED_ORIGINS`. Production requires HTTPS, with TLS terminated by the deployment environment. Configure `TRUST_PROXY_HOPS` only for a known reverse-proxy chain; the default trusts none.

Use `npm run build` and `npm start` to run compiled code. Startup checks that auth tables exist; it does not create/migrate schemas automatically.

## Confirmed account configuration

The requester confirmed these settings on 2026-11-11:

- Session lifetime: 7 days (`604800` seconds).
- Verification/reset links: 15 minutes (`900` seconds), independently scoped by user and purpose.
- Email requests: 60-second cooldown and at most 5 requests per 15-minute window for each recipient/purpose.
- SMTP acceptance gates activation: preparing a replacement does not invalidate an existing link. After the SMTP server accepts the message, an activation transaction replaces the current credential. Rejection/failure before acceptance preserves the previous active link.

Link expiry starts when the credential is generated; waiting for SMTP does not extend it. SMTP acceptance is not proof of inbox delivery. Anonymous email operations return a generic acceptance response, not delivery or account-existence evidence. Messages are sent asynchronously after the auth transaction commits. A crash can interrupt in-process pending sends; users can request another email. This release does not claim a durable mail outbox or guaranteed inbox delivery.

The request limiter counts accepted attempts, including failed sends. Unknown addresses follow the same request-limit behavior, and SMTP failure does not reset the quota.

These confirmations resolve the corresponding implementation choices that the older PRD/database-design text still records as open; they do not change the other unresolved product decisions.

## Integration boundary

See [the implementation guide](../docs/Auth_Implementation.md) for the physical schema, shared identity and route behavior.

- `createAuthentication(...)` exposes the protected project handler and an authoritative `getSession`; use this facade rather than an independent Better Auth instance.
- Auth-owned tables use the `auth_` prefix. The authoritative user key is `public.auth_user.id UUID`; business owner FKs must use the same type.
- `requireVerifiedUser(authentication)` establishes `res.locals.auth` from the server Session. `requireOwnedResource(database, kind, parameter)` checks application/resume/workspace/conversation ownership.
- The `/api/v1` mount in `createApp` applies the verified-session gate before business routers. Business CRUD remains a separate module responsibility; it is not implemented by this auth change. Mount handlers with the ownership middleware and preserve owner-scoped SQL/lifecycle validation.
- Authentication errors use top-level `code`/`message`; business authorization errors use `{ "error": { "code", "message" } }`.

## Checks

```bash
npm run typecheck
npm run typecheck:tests
npm run build
npm test
```

`npm test` creates a disposable PostgreSQL cluster using local server binaries and a private Unix socket, then creates/drops randomly named databases within it. It needs permission to create local sockets and must run as a non-root PostgreSQL-capable user. Alternatively, provide `TEST_DATABASE_URL` for an isolated PostgreSQL test server with `CREATE DATABASE` permission. Never use the application database or production credentials for tests. SMTP integration uses a localhost-only test server and sends no external mail.

`npm run test:contract` runs the tests that do not require a database; the adapter PostgreSQL sub-suite runs when a test-server URL is provided. `npm run test:integration` requires `TEST_DATABASE_URL`. `npm run migrate:down` rolls back one migration and can destroy auth data; use it only against an appropriate development/test database.
