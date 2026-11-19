import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedRequestOrigin } from "../../src/http/origin.js";

const TRUSTED = ["http://localhost:5173"];
const check = (method: string, origin: string | null, fetchSite: string | null, strict: boolean) =>
  isTrustedRequestOrigin({ method, origin, fetchSite }, TRUSTED, { strict });

test("business API (non-strict): only unsafe methods are checked", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(check(method, "https://evil.example", "cross-site", false), true, method);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(check(method, "http://localhost:5173", null, false), true, method);
    assert.equal(check(method, "https://evil.example", null, false), false, method);
    assert.equal(check(method, null, "cross-site", false), false, method);
    assert.equal(check(method, null, "same-origin", false), true, method);
    assert.equal(check(method, null, null, false), true, `${method} from a non-browser client`);
  }
});

test("auth endpoints (strict): a present Origin must be trusted for every method", () => {
  assert.equal(check("GET", "https://evil.example", null, true), false);
  assert.equal(check("GET", "http://localhost:5173", null, true), true);
  // An emailed link opened in the browser carries no Origin.
  assert.equal(check("GET", null, "cross-site", true), true);
  assert.equal(check("POST", null, "cross-site", true), false);
  assert.equal(check("POST", "https://evil.example", "same-origin", true), false);
});
