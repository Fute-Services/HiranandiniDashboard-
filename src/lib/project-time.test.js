import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectTime,
  getProjectVisits,
  pauseProjectTimer,
  readOpenProject,
  resumeProjectTimer,
  startProjectTimer,
  stopProjectTimer,
} from "./project-time";

/**
 * These cover the rules the per-project seconds in Sperto's `page_url` have
 * to hold to, all of which
 * are easy to get wrong in a way nobody notices until a report is already in
 * the client's hands: reopening a project must add to it rather than replace
 * it or duplicate it, two projects must never run at once, a project nobody
 * opened must not appear at all, and a backgrounded tab must not accrue time.
 *
 * No DOM here (see vitest.config.mjs) — sessionStorage is stubbed, and the
 * module's visibilitychange hook no-ops when `document` is undefined, so
 * pause/resume are driven directly.
 */

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
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
const seconds = (n) => vi.advanceTimersByTime(n * 1000);

/**
 * The visits as one object, name against seconds. The rules below are about
 * the numbers rather than the array they sit in, and reading them this way
 * keeps each assertion to the thing it is actually testing. What goes out is
 * minutes to two decimals; converting back and rounding to the second keeps
 * these assertions in the unit the scenarios are written in.
 */
const secondsByProject = () =>
  Object.fromEntries(
    Object.entries(Object.assign({}, ...getProjectVisits())).map(([p, min]) => [
      p,
      Math.round(min * 60),
    ]),
  );

describe("the seconds a project is reported with", () => {
  it("is empty before anything is opened", () => {
    expect(secondsByProject()).toEqual({});
  });

  it("reports a project that is still open, counted up to now", () => {
    startProjectTimer("Fortune City");
    seconds(45);
    expect(secondsByProject()).toEqual({ "Fortune City": 45 });
  });

  it("leaves out projects that were never opened", () => {
    startProjectTimer("Fortune City");
    seconds(30);
    stopProjectTimer();
    expect(secondsByProject()).not.toHaveProperty("Alibaug");
  });

  it("leaves out a project opened and closed inside the same second", () => {
    startProjectTimer("Fortune City");
    stopProjectTimer();
    // A mis-tap is not a visit, and "0" in the CRM reads like one that was.
    expect(secondsByProject()).toEqual({});
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

    expect(secondsByProject()).toEqual({ "Project A": 300 });
  });

  it("keeps one entry per project however many times it is opened", () => {
    for (let i = 0; i < 4; i++) {
      startProjectTimer("Project A");
      seconds(10);
      stopProjectTimer();
    }
    expect(Object.keys(secondsByProject())).toEqual(["Project A"]);
    expect(secondsByProject()["Project A"]).toBe(40);
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
    expect(secondsByProject()).toEqual({ "Project A": 300, "Project B": 240 });
  });

  it("accumulates across an interleaved A → B → A visit", () => {
    startProjectTimer("Project A");
    seconds(100);
    startProjectTimer("Project B");
    seconds(50);
    startProjectTimer("Project A");
    seconds(200);
    stopProjectTimer();

    expect(secondsByProject()).toEqual({ "Project A": 300, "Project B": 50 });
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

    expect(secondsByProject()).toEqual({ "Project A": 120 });
  });

  it("survives a pause with nothing open", () => {
    pauseProjectTimer();
    resumeProjectTimer();
    expect(secondsByProject()).toEqual({});
  });
});

describe("stopProjectTimer", () => {
  it("is safe to call twice and does not double-count", () => {
    startProjectTimer("Project A");
    seconds(30);
    stopProjectTimer();
    seconds(30);
    stopProjectTimer();

    expect(secondsByProject()).toEqual({ "Project A": 30 });
  });
});

describe("clearProjectTime", () => {
  it("leaves nothing for the next customer's session to inherit", () => {
    startProjectTimer("Project A");
    seconds(120);
    clearProjectTime();
    expect(secondsByProject()).toEqual({});
  });
});

/**
 * The header's live per-project clock. What matters is that it agrees with
 * what the OUT call will eventually send — a timer that reads differently
 * from the recorded value is worse than no timer, because a staff member
 * would trust it.
 */
describe("readOpenProject", () => {
  it("is null when no project is open", () => {
    expect(readOpenProject()).toBeNull();
    startProjectTimer("Elena");
    stopProjectTimer();
    expect(readOpenProject()).toBeNull();
  });

  it("counts the running clock for the project on screen", () => {
    startProjectTimer("Elena");
    seconds(45);
    expect(readOpenProject()).toEqual({ project: "Elena", ms: 45_000 });
  });

  it("continues a reopened project's total rather than restarting it", () => {
    startProjectTimer("Elena");
    seconds(180);
    startProjectTimer("Ebony");
    seconds(60);
    startProjectTimer("Elena");
    seconds(120);
    // 3 min before, 2 min now — the same 300s the OUT call reports.
    expect(readOpenProject()).toEqual({ project: "Elena", ms: 300_000 });
    expect(secondsByProject().Elena).toBe(300);
  });

  it("holds steady while the tab is backgrounded", () => {
    startProjectTimer("Elena");
    seconds(30);
    pauseProjectTimer();
    seconds(600);
    expect(readOpenProject()).toEqual({ project: "Elena", ms: 30_000 });
    resumeProjectTimer();
    seconds(10);
    expect(readOpenProject()).toEqual({ project: "Elena", ms: 40_000 });
  });

  it("does not bank time, so ticking it every second cannot inflate the total", () => {
    startProjectTimer("Elena");
    seconds(10);
    for (let i = 0; i < 20; i++) readOpenProject();
    seconds(10);
    expect(secondsByProject()).toEqual({ Elena: 20 });
  });
});

/**
 * The array Sperto's `page_url` field carries on the "OUT" call: one object
 * per project, name against minutes (two decimals). It is the only field the times go out
 * in, so its order and its grouping are exactly what the CRM ends up showing.
 */
describe("getProjectVisits", () => {
  it("is empty before anything is opened", () => {
    expect(getProjectVisits()).toEqual([]);
  });

  it("reports the project by name, with its minutes", () => {
    startProjectTimer("Elena");
    seconds(180);
    expect(getProjectVisits()).toEqual([{ Elena: 3 }]);
  });

  it("lists projects in the order they were first opened", () => {
    startProjectTimer("Elena");
    seconds(60);
    startProjectTimer("Ebony");
    seconds(30);
    expect(getProjectVisits()).toEqual([{ Elena: 1 }, { Ebony: 0.5 }]);
  });

  it("keeps one entry per project when it is reopened, not two", () => {
    startProjectTimer("Elena");
    seconds(180);
    startProjectTimer("Ebony");
    seconds(60);
    startProjectTimer("Elena");
    seconds(120);
    stopProjectTimer();
    // Elena's two visits are one 5-minute entry, still in first-open order.
    expect(getProjectVisits()).toEqual([{ Elena: 5 }, { Ebony: 1 }]);
  });

  it("leaves out a project opened and closed inside the same second", () => {
    startProjectTimer("Elena");
    stopProjectTimer();
    // Same rule the seconds map keeps: a mis-tap is not a visit, and a "0"
    // in the CRM reads like one that was.
    expect(getProjectVisits()).toEqual([]);
  });

  it("does not accrue while the tab is backgrounded", () => {
    startProjectTimer("Elena");
    seconds(30);
    pauseProjectTimer();
    seconds(3600);
    resumeProjectTimer();
    seconds(30);
    expect(getProjectVisits()).toEqual([{ Elena: 1 }]);
  });

  it("counts the project still on screen when Log out is pressed", () => {
    startProjectTimer("Elena");
    seconds(45);
    // No stopProjectTimer() — this is the logout case, where the viewer is
    // still open and the clock still running.
    expect(getProjectVisits()).toEqual([{ Elena: 0.75 }]);
  });

  it("leaves nothing for the next customer to inherit", () => {
    startProjectTimer("Elena");
    seconds(120);
    clearProjectTime();
    expect(getProjectVisits()).toEqual([]);
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
    expect(secondsByProject()).toEqual({});
  });
});

describe("the minutes page_url carries", () => {
  it("keeps a look shorter than a minute instead of rounding it away", () => {
    startProjectTimer("Elena");
    seconds(20);
    expect(getProjectVisits()).toEqual([{ Elena: 0.33 }]);
  });

  it("rounds to two decimals once, on the total", () => {
    startProjectTimer("Elena");
    seconds(90);
    stopProjectTimer();
    startProjectTimer("Elena");
    seconds(1);
    // 91s is 1.5166… minutes.
    expect(getProjectVisits()).toEqual([{ Elena: 1.52 }]);
  });
});
