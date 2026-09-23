import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, trackedKeyCount } from "./rate-limit.js";

/**
 * The limiter holds one bucket per key it has ever seen, and the keys are
 * client IPs and typed email addresses — unbounded, and supplied by whoever
 * is calling. Nothing reclaimed them, so a process that stays up (a showroom
 * server, which is the intended deployment) grew by one entry per distinct
 * caller until it was restarted.
 *
 * Fake timers rather than real waiting: the sweep is on a one-minute cadence
 * by design, and a test that took a minute to prove it would not be run.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe("rate limiting many callers", () => {
  it("lets each caller through on its own key", () => {
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit(`spread:${i}`, 2, 60_000)).toBe(true);
    }
  });

  it("refuses the one caller that goes over, and nobody else", () => {
    expect(checkRateLimit("noisy", 2, 60_000)).toBe(true);
    expect(checkRateLimit("noisy", 2, 60_000)).toBe(true);
    expect(checkRateLimit("noisy", 2, 60_000)).toBe(false);
    expect(checkRateLimit("quiet", 2, 60_000)).toBe(true);
  });

  it("reclaims the keys of callers that have gone away", () => {
    vi.useFakeTimers();
    // Far enough ahead that the keys the tests above left behind are stale
    // too, so what is counted here is this test's own burst and nothing else.
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));

    for (let i = 0; i < 500; i++) checkRateLimit(`gone:${i}`, 10, 60_000);
    const afterBurst = trackedKeyCount();
    expect(afterBurst).toBeGreaterThanOrEqual(500);

    // Long enough that every one of those windows has expired, and long
    // enough for the sweep to be due.
    vi.advanceTimersByTime(5 * 60_000);
    checkRateLimit("someone-still-here", 10, 60_000);

    // The 500 are gone; what is left is the caller that just arrived.
    expect(trackedKeyCount()).toBeLessThan(afterBurst);
    expect(trackedKeyCount()).toBeLessThanOrEqual(2);
  });

  it("does not drop a window that is still open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    checkRateLimit("mid-window", 2, 60_000);
    checkRateLimit("mid-window", 2, 60_000);
    // A sweep becomes due, but this caller's own window has not expired.
    vi.advanceTimersByTime(61_000 - 30_000);
    vi.advanceTimersByTime(30_000 - 1_000);
    expect(checkRateLimit("mid-window", 2, 60_000)).toBe(false);
  });
});
