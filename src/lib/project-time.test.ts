import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectTime,
  getProjectTimeSeconds,
  pauseProjectTimer,
  resumeProjectTimer,
  startProjectTimer,
  stopProjectTimer,
} from "./project-time";

/**
 * These cover the rules Sperto's `project_time` has to hold to, all of which
 * are easy to get wrong in a way nobody notices until a report is already in
 * the client's hands: reopening a project must add to it rather than replace
 * it or duplicate it, two projects must never run at once, a project nobody
 * opened must not appear at all, and a backgrounded tab must not accrue time.
 *
 * No DOM here (see vitest.config.mts) — sessionStorage is stubbed, and the
 * module's visibilitychange hook no-ops when `document` is undefined, so
 * pause/resume are driven directly.
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Advance the clock without waiting for it. */
const seconds = (n: number) => vi.advanceTimersByTime(n * 1000);

describe("getProjectTimeSeconds", () => {
  it("is empty before anything is opened", () => {
    expect(getProjectTimeSeconds()).toEqual({});
  });

  it("reports a project that is still open, counted up to now", () => {
    startProjectTimer("Fortune City");
    seconds(45);
    expect(getProjectTimeSeconds()).toEqual({ "Fortune City": 45 });
  });

  it("leaves out projects that were never opened", () => {
    startProjectTimer("Fortune City");
    seconds(30);
    stopProjectTimer();
    expect(getProjectTimeSeconds()).not.toHaveProperty("Alibaug");
  });

  it("leaves out a project opened and closed inside the same second", () => {
    startProjectTimer("Fortune City");
    stopProjectTimer();
    // A mis-tap is not a visit, and "0" in the CRM reads like one that was.
    expect(getProjectTimeSeconds()).toEqual({});
  });
});

describe("reopening the same project", () => {
  it("adds to the existing total instead of replacing it", () => {
    startProjectTimer("Project A");
    seconds(180);
    stopProjectTimer();

    startProjectTimer("Project A");
    seconds(120);
    stopProjectTimer();

    expect(getProjectTimeSeconds()).toEqual({ "Project A": 300 });
  });

  it("keeps one entry per project however many times it is opened", () => {
    for (let i = 0; i < 4; i++) {
      startProjectTimer("Project A");
      seconds(10);
      stopProjectTimer();
    }
    expect(Object.keys(getProjectTimeSeconds())).toEqual(["Project A"]);
    expect(getProjectTimeSeconds()["Project A"]).toBe(40);
  });
});

describe("navigating between projects", () => {
  it("stops the previous project's clock when the next one opens", () => {
    startProjectTimer("Project A");
    seconds(300);
    // Straight from one project into another, with no close in between.
    startProjectTimer("Project B");
    seconds(240);

    // 540s of wall clock, split — not counted twice.
    expect(getProjectTimeSeconds()).toEqual({ "Project A": 300, "Project B": 240 });
  });

  it("accumulates across an interleaved A → B → A visit", () => {
    startProjectTimer("Project A");
    seconds(100);
    startProjectTimer("Project B");
    seconds(50);
    startProjectTimer("Project A");
    seconds(200);
    stopProjectTimer();

    expect(getProjectTimeSeconds()).toEqual({ "Project A": 300, "Project B": 50 });
  });
});

describe("time when the tab is not being looked at", () => {
  it("does not accrue while paused", () => {
    startProjectTimer("Project A");
    seconds(60);
    pauseProjectTimer();
    seconds(3600); // an hour on some other tab
    resumeProjectTimer();
    seconds(60);

    expect(getProjectTimeSeconds()).toEqual({ "Project A": 120 });
  });

  it("survives a pause with nothing open", () => {
    pauseProjectTimer();
    resumeProjectTimer();
    expect(getProjectTimeSeconds()).toEqual({});
  });
});

describe("stopProjectTimer", () => {
  it("is safe to call twice and does not double-count", () => {
    startProjectTimer("Project A");
    seconds(30);
    stopProjectTimer();
    seconds(30);
    stopProjectTimer();

    expect(getProjectTimeSeconds()).toEqual({ "Project A": 30 });
  });
});

describe("clearProjectTime", () => {
  it("leaves nothing for the next customer's session to inherit", () => {
    startProjectTimer("Project A");
    seconds(120);
    clearProjectTime();
    expect(getProjectTimeSeconds()).toEqual({});
  });
});

describe("storage that refuses to work", () => {
  it("never throws, so a locked-down kiosk cannot break the click handler", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });

    expect(() => {
      startProjectTimer("Project A");
      seconds(30);
      stopProjectTimer();
      pauseProjectTimer();
      resumeProjectTimer();
      clearProjectTime();
    }).not.toThrow();
    expect(getProjectTimeSeconds()).toEqual({});
  });
});
