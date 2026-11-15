import assert from "node:assert/strict";
import test from "node:test";
import { loadEnvironment } from "../../src/config/env.js";
import { validateCallback, withQuery } from "../../src/modules/auth/callbacks.js";

const base = {
  DATABASE_URL: "postgresql://localhost/jobflow_test",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "c04f71f9cfc36dc348b8cfaad0debd7f7138bc98f152be57e69c624aa3835c371",
  AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1", SMTP_FROM: "JobFlow <auth@example.com>",
};

test("configuration reflects the user's confirmed session and email limits", () => {
  const { auth } = loadEnvironment(base);
  assert.equal(auth.sessionLifetimeSeconds, 7 * 24 * 60 * 60);
  assert.equal(auth.emailCooldownSeconds, 60);
  assert.equal(auth.emailWindowSeconds, 900);
  assert.equal(auth.emailMaxPerWindow, 5);
  assert.equal(auth.secureCookies, false);
  assert.equal(loadEnvironment({ ...base, SMTP_USER: "smtp-user", SMTP_PASSWORD: "  private-password  " }).smtp.password, "  private-password  ");
});

test("production requires HTTPS and a private secret without exposing values", () => {
  assert.throws(() => loadEnvironment({ ...base, NODE_ENV: "production" }), /HTTPS/);
  assert.throws(() => loadEnvironment({ ...base, BETTER_AUTH_SECRET: "replace-with-a-secret" }), /private random/);
  assert.throws(() => loadEnvironment({ ...base, AUTH_COOKIE_SAME_SITE: "none" }), /requires HTTPS/);
  assert.throws(() => loadEnvironment({ ...base, SMTP_PASSWORD: "private-password" }), /provided together/);
  const secure = loadEnvironment({ ...base, NODE_ENV: "production", BETTER_AUTH_URL: "https://api.example.com", AUTH_TRUSTED_ORIGINS: "https://app.example.com" });
  assert.equal(secure.auth.secureCookies, true);
  const badDatabase = "postgresql://private-user:private-password@localhost/";
  assert.throws(() => loadEnvironment({ ...base, DATABASE_URL: badDatabase }), error => !String(error).includes("private-password"));
});

test("callback validation rejects open redirects and encoded authority/control tricks", () => {
  const trusted = ["https://app.example.com"];
  for (const url of ["/dashboard?tab=jobs#top", "https://app.example.com/reset?next=%2Fdashboard", ""]) validateCallback(url, trusted);
  for (const url of ["//evil.example", "/%2fevil.example", "/\\evil.example", "https://app.example.com.evil.example/", "https://app.example.com@evil.example/", "javascript:alert(1)", "/callback?x=%0d%0aLocation:evil", "https://user:password@app.example.com/"]) {
    assert.throws(() => validateCallback(url, trusted));
  }
});

test("callback parameters preserve existing query values and fragments", () => {
  assert.equal(withQuery("/reset?theme=dark#form", "https://app.example.com", "error", "INVALID_TOKEN"), "/reset?theme=dark&error=INVALID_TOKEN#form");
  assert.equal(withQuery("https://app.example.com/reset?theme=dark", "https://api.example.com", "token", "opaque-token"), "https://app.example.com/reset?theme=dark&token=opaque-token");
});
