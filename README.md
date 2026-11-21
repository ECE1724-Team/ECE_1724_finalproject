# ECE_1724_finalproject

See the [backend README](backend/README.md) for setup, commands, R2 storage and PDF parsing.

## Quick start on macOS

Uses [Homebrew](https://brew.sh). Linux, WSL and full `.env` details: [backend README](backend/README.md#local-configuration).

**1. Install the tools** (once)

```sh
brew install node postgresql@18 mailpit
brew link --force postgresql@18      # puts createdb and psql on PATH
brew services start postgresql@18
node -v                              # must print v26.x
```

**2. Create the database** (once). Homebrew's PostgreSQL needs no user or password locally,
so the default `DATABASE_URL` in `.env.example` works as is.

```sh
createdb jobflow_dev
```

**3. Configure the backend** (once)

```sh
cd backend
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the printed value into `.env` as `BETTER_AUTH_SECRET`. Leave the `R2_*` values empty
unless you need resume upload; empty values disable the resume routes.

**4. Create the tables.** Run this again after every pull.

```sh
npm run migrate
```

**5. Start everything**, each in its own terminal:

```sh
mailpit                         # email inbox at http://localhost:8025
cd backend && npm run dev       # API at http://localhost:3000
cd frontend && npm ci && npm run dev   # app at http://localhost:5173
```

The backend is ready when it prints `JobFlow API listening on port 3000`. After you sign up,
open the verification email in Mailpit. `npm run dev` does not reload: press Ctrl+C and run it
again after changing backend code.
