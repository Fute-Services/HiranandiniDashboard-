import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectTime,
  getProjectTimeSeconds,
  getProjectVisits,
  pauseProjectTimer,
  readOpenProject,
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
    // 3 min before, 2 min now — the same 300s getProjectTimeSeconds reports.
    expect(readOpenProject()).toEqual({ project: "Elena", ms: 300_000 });
    expect(getProjectTimeSeconds().Elena).toBe(300);
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
    expect(getProjectTimeSeconds()).toEqual({ Elena: 20 });
  });
});

/**
 * The array Sperto's `page_url` field carries on the "OUT" call: one object
 * per project, name against seconds. It has to agree with
 * `getProjectTimeSeconds` exactly — the two fields describe the same visits,
 * and a CRM showing two different numbers for one presentation is worse than
 * a CRM showing one.
 */
describe("getProjectVisits", () => {
  it("is empty before anything is opened", () => {
    expect(getProjectVisits()).toEqual([]);
  });

  it("reports the project by name, with its seconds", () => {
    startProjectTimer("Elena");
    seconds(180);
    expect(getProjectVisits()).toEqual([{ Elena: 180 }]);
  });

  it("lists projects in the order they were first opened", () => {
    startProjectTimer("Elena");
    seconds(60);
    startProjectTimer("Ebony");
    seconds(30);
    expect(getProjectVisits()).toEqual([{ Elena: 60 }, { Ebony: 30 }]);
  });

  it("keeps one entry per project when it is reopened, not two", () => {
    startProjectTimer("Elena");
    seconds(180);
    startProjectTimer("Ebony");
    seconds(60);
    startProjectTimer("Elena");
    seconds(120);
    stopProjectTimer();
    // Elena's two visits are one 300s entry, still in first-open order.
    expect(getProjectVisits()).toEqual([{ Elena: 300 }, { Ebony: 60 }]);
  });

  it("agrees with getProjectTimeSeconds, second for second", () => {
    startProjectTimer("Elena");
    seconds(95);
    startProjectTimer("Ebony");
    seconds(40);
    stopProjectTimer();
    const byName = getProjectTimeSeconds();
    // The array is the same map, one key per object — flattening it back must
    // reproduce the other field exactly.
    const flattened = Object.assign({}, ...getProjectVisits());
    expect(flattened).toEqual(byName);
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
    expect(getProjectVisits()).toEqual([{ Elena: 60 }]);
  });

  it("counts the project still on screen when Log out is pressed", () => {
    startProjectTimer("Elena");
    seconds(45);
    // No stopProjectTimer() — this is the logout case, where the viewer is
    // still open and the clock still running.
    expect(getProjectVisits()).toEqual([{ Elena: 45 }]);
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
    expect(getProjectTimeSeconds()).toEqual({});
  });
});
