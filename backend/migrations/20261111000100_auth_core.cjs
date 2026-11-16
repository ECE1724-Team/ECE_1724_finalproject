/**
 * Better Auth 1.7.20's PostgreSQL core schema, with auth_ model names and
 * advanced.database.generateId = "uuid". Preserve the library's camelCase
 * columns so runtime and schema checks use the same physical mapping.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.auth_user (
      id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE public.auth_session (
      id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      "expiresAt" TIMESTAMPTZ NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" UUID NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE
    );
    CREATE INDEX "auth_session_userId_idx" ON public.auth_session ("userId");

    CREATE TABLE public.auth_account (
      id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" UUID NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMPTZ,
      "refreshTokenExpiresAt" TIMESTAMPTZ,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "auth_account_userId_idx" ON public.auth_account ("userId");

    CREATE TABLE public.auth_verification (
      id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX auth_verification_identifier_idx
      ON public.auth_verification (identifier);

    CREATE TABLE public.auth_rate_limit (
      id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      key TEXT NOT NULL UNIQUE,
      count INTEGER NOT NULL,
      "lastRequest" BIGINT NOT NULL
    );
  `);
};

exports.down = (pgm) => {
  // Do not cascade into future business tables; their migrations must roll back first.
  pgm.sql(`
    DROP TABLE public.auth_rate_limit;
    DROP TABLE public.auth_verification;
    DROP TABLE public.auth_account;
    DROP TABLE public.auth_session;
    DROP TABLE public.auth_user;
  `);
};
