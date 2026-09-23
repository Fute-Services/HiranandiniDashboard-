import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a presentation actually POSTs to `/api/session/device-usage`.
 *
 * `project-time.test.js` covers the accounting; this covers the envelope the
 * numbers travel in — which is the part the client's CRM parses, and the part
 * that is expensive to get wrong: their server ignores fields it doesn't
 * understand and answers 200 either way, so a wrong shape looks exactly like
 * success from our side and only shows up as missing data in their reports,
 * weeks later.
 *
 * Driven through the real modules with only the browser globals stubbed, so
 * this breaks if `session.js` or `project-time.js` changes what goes on the
 * wire — not just if a helper's return value changes.
 */

const LEAD = { leadId: "985038", name: "Rohit Sharma" };

let sent;
let store;
let realDateNow;
let clock;

/** The session and project-time modules, freshly imported so their
 * module-level state (the visibility hook) can't leak between tests. */
async function load() {
  vi.resetModules();
  return {
    session: await import("./session.js"),
    time: await import("./project-time.js"),
  };
}

beforeEach(() => {
  store = new Map();
  sent = [];

  vi.stubGlobal("sessionStorage", {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  });
  vi.stubGlobal("window", {
    location: { href: "http://localhost:3000/dashboard" },
    setTimeout,
  });
  vi.stubGlobal("document", { cookie: "", addEventListener() {} });
  vi.stubGlobal("navigator", { userAgent: "test" });
  vi.stubGlobal("fetch", async (url, init) => {
    if (String(url).includes("device-usage")) sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true }) };
  });

  // A hand-cranked clock, so a presentation's minutes pass instantly and the
  // expected seconds are exact rather than approximate.
  realDateNow = Date.now;
  clock = realDateNow();
  Date.now = () => clock;
});

afterEach(() => {
  Date.now = realDateNow;
  vi.unstubAllGlobals();
});

const minutes = (n) => {
  clock += n * 60_000;
};

const callOf = (type) => sent.find((b) => b.type === type);

describe("what a presentation sends Sperto", () => {
  it("reports the page it started on, and no times, on IN", async () => {
    const { session } = await load();
    session.setActiveSession(LEAD, "TV");

    expect(callOf("IN")).toMatchObject({
      leadId: "985038",
      deviceType: "TV",
      // Nothing has been opened yet, so the field keeps its original meaning.
      pageUrl: "http://localhost:3000/dashboard",
    });
    expect(Object.keys(callOf("IN")).sort()).toEqual(["deviceType", "leadId", "pageUrl", "type"]);
  });

  it("puts the per-project seconds in page_url, one object per project", async () => {
    const { session, time } = await load();
    session.setActiveSession(LEAD, "TV");

    time.startProjectTimer("Elena");
    minutes(3);
    time.startProjectTimer("Alibaug");
    minutes(4);
    time.stopProjectTimer();

    session.finalizeSession();

    const out = callOf("OUT");
    expect(out.pageUrl).toEqual([{ Elena: 180 }, { Alibaug: 240 }]);
    // Their own field, and the only one: nothing carrying the same numbers
    // goes out beside it. A `project_time` custom field used to, and the
    // client asked for it to stop, so this is the assertion that keeps it off.
    expect(Object.keys(out).sort()).toEqual(["deviceType", "leadId", "pageUrl", "type"]);
  });

  it("counts the project still on screen when the staff member logs out", async () => {
    const { session, time } = await load();
    session.setActiveSession(LEAD, "Kiosk");

    time.startProjectTimer("Elena");
    minutes(5);
    // No stopProjectTimer — Elena is still open when Log out is pressed.
    session.finalizeSession();

    expect(callOf("OUT").pageUrl).toEqual([{ Elena: 300 }]);
  });

  it("falls back to the page URL when nothing was opened", async () => {
    const { session } = await load();
    session.setActiveSession(LEAD, "Tab");
    session.finalizeSession();

    const out = callOf("OUT");
    // An empty array would read as "a visit with no projects"; the page the
    // presentation ended on is the honest answer.
    expect(out.pageUrl).toBe("http://localhost:3000/dashboard");
  });

  it("sends exactly one OUT, however many times the session is finalized", async () => {
    const { session, time } = await load();
    session.setActiveSession(LEAD, "TV");
    time.startProjectTimer("Elena");
    minutes(2);

    // The showcase's Log out calls this, and signOut() calls it again.
    session.finalizeSession();
    session.finalizeSession();
    session.finalizeSession();

    expect(sent.filter((b) => b.type === "OUT")).toHaveLength(1);
  });

  it("never carries one customer's time into the next presentation", async () => {
    const { session, time } = await load();

    session.setActiveSession(LEAD, "TV");
    time.startProjectTimer("Elena");
    minutes(3);
    session.finalizeSession();

    sent.length = 0;
    session.setActiveSession({ leadId: "985039", name: "Someone Else" }, "TV");
    time.startProjectTimer("Ebony");
    minutes(1);
    session.finalizeSession();

    expect(callOf("OUT").pageUrl).toEqual([{ Ebony: 60 }]);
  });
});
