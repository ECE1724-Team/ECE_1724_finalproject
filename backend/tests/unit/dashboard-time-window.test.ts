import assert from "node:assert/strict";
import test from "node:test";
import { isTimeZone, upcomingWindow } from "../../src/modules/dashboard/time-window.js";

function window(timeZone: string, now: string) {
  const result = upcomingWindow(timeZone, new Date(now));
  assert.ok(result, `${timeZone} should be accepted`);
  return { start: result.start.toISOString(), end: result.end.toISOString(), hours: (result.end.getTime() - result.start.getTime()) / 3_600_000 };
}

test("the window runs from local midnight today to local midnight seven calendar dates later", () => {
  assert.deepEqual(window("America/Toronto", "2026-11-20T15:00:00Z"),
    { start: "2026-11-20T05:00:00.000Z", end: "2026-11-27T05:00:00.000Z", hours: 168 });
  // 22:00 on Nov 19 in Toronto is still Nov 19 there, although it is Nov 20 in UTC.
  assert.deepEqual(window("America/Toronto", "2026-11-20T03:00:00Z"),
    { start: "2026-11-19T05:00:00.000Z", end: "2026-11-26T05:00:00.000Z", hours: 168 });
  assert.deepEqual(window("UTC", "2026-11-20T23:59:59.999Z"),
    { start: "2026-11-20T00:00:00.000Z", end: "2026-11-27T00:00:00.000Z", hours: 168 });
});

test("calendar dates, not 168 hours, across daylight-saving changes", () => {
  // Clocks fall back on Nov 1: the window is 169 hours (the same window as dashboard.db.test.ts).
  assert.deepEqual(window("America/Toronto", "2026-10-29T12:00:00Z"),
    { start: "2026-10-29T04:00:00.000Z", end: "2026-11-05T05:00:00.000Z", hours: 169 });
  // Clocks spring forward on Mar 8: 167 hours.
  assert.deepEqual(window("America/Toronto", "2026-03-05T12:00:00Z"),
    { start: "2026-03-05T05:00:00.000Z", end: "2026-03-12T04:00:00.000Z", hours: 167 });
  // Santiago skips local midnight on Sep 6: that day starts at 01:00 local time.
  assert.deepEqual(window("America/Santiago", "2026-09-06T12:00:00Z"),
    { start: "2026-09-06T04:00:00.000Z", end: "2026-09-13T03:00:00.000Z", hours: 167 });
  // A window that ends on that skipped midnight.
  assert.deepEqual(window("America/Santiago", "2026-08-31T12:00:00Z"),
    { start: "2026-08-31T04:00:00.000Z", end: "2026-09-07T03:00:00.000Z", hours: 167 });
});

test("half-hour and far-east offsets", () => {
  assert.deepEqual(window("Asia/Kolkata", "2026-11-20T20:00:00Z"),
    { start: "2026-11-20T18:30:00.000Z", end: "2026-11-27T18:30:00.000Z", hours: 168 });
  assert.deepEqual(window("Pacific/Kiritimati", "2026-11-20T09:59:59Z"),
    { start: "2026-11-19T10:00:00.000Z", end: "2026-11-26T10:00:00.000Z", hours: 168 });
  assert.deepEqual(window("Pacific/Kiritimati", "2026-11-20T10:00:00Z"),
    { start: "2026-11-20T10:00:00.000Z", end: "2026-11-27T10:00:00.000Z", hours: 168 });
});

test("time zone names: IANA names in any case are accepted and echoed as sent; others are rejected", () => {
  assert.equal(upcomingWindow("america/toronto", new Date("2026-11-20T15:00:00Z"))?.timeZone, "america/toronto");
  assert.equal(window("america/toronto", "2026-11-20T15:00:00Z").start, "2026-11-20T05:00:00.000Z");
  assert.equal(upcomingWindow("Asia/Kolkata", new Date())?.timeZone, "Asia/Kolkata");
  for (const value of ["", "Not/AZone", "Toronto", "x".repeat(101)]) {
    assert.equal(isTimeZone(value), false, value);
    assert.equal(upcomingWindow(value, new Date()), null, value);
  }
});
