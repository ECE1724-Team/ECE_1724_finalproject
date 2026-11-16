/**
 * Project state for latest-credential enforcement and email-request limiting.
 * sequence reserves pre-send ordering. Active credential fields change only in
 * the post-SMTP activation transaction, leaving an older link usable on failure.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.auth_credential_state (
      user_id UUID NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      sequence BIGINT NOT NULL DEFAULT 0,
      active_sequence BIGINT,
      current_issuance_id UUID,
      current_token_digest TEXT,
      issued_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, purpose),
      CONSTRAINT auth_credential_state_purpose_check
        CHECK (purpose IN ('email_verification', 'password_reset')),
      CONSTRAINT auth_credential_state_sequence_check
        CHECK (sequence >= 0),
      CONSTRAINT auth_credential_state_active_fields_check CHECK (
        (
          active_sequence IS NULL
          AND current_issuance_id IS NULL
          AND current_token_digest IS NULL
          AND issued_at IS NULL
          AND expires_at IS NULL
        )
        OR
        (
          active_sequence IS NOT NULL
          AND current_issuance_id IS NOT NULL
          AND current_token_digest IS NOT NULL
          AND issued_at IS NOT NULL
          AND expires_at IS NOT NULL
          AND active_sequence > 0
          AND active_sequence <= sequence
          AND expires_at > issued_at
        )
      )
    );

    CREATE TABLE public.auth_email_rate_limit (
      key TEXT PRIMARY KEY,
      window_started_at TIMESTAMPTZ NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_requested_at TIMESTAMPTZ,
      CONSTRAINT auth_email_rate_limit_request_count_check
        CHECK (request_count >= 0)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE public.auth_email_rate_limit;
    DROP TABLE public.auth_credential_state;
  `);
};
