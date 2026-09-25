import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSpertoConfigured, spertoEmailExists, spertoLeadExists } from "./sperto.js";

/**
 * The login door hangs entirely on this one call, and the ways it can be read
 * wrong are all quirks of *their* server rather than of ours: errors arrive
 * as HTTP 200, the body is labelled text/html, and a rejection that blames
 * the api_key must not be reported to a staff member as "your email is
 * wrong". Those are what these cover.
 *
 * The `server-only` stub the Next.js build needed is gone: this module lives
 * under `server/` now, which was always the point of that marker, and a plain
 * Node test runner can import it directly.
 */

const BASE = "https://sperto.example/_api";

/** Their server always answers 200 — the body is the only signal. */
function reply(body, init = {}) {
  const text = init.text ?? JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    // Labelled text/html despite being JSON, exactly as the real one does.
    headers: { "Content-Type": "text/html" },
  });
}

let fetchMock;

beforeEach(() => {
  process.env.SPERTO_BASE_URL = BASE;
  process.env.SPERTO_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.SPERTO_BASE_URL;
  delete process.env.SPERTO_API_KEY;
  vi.unstubAllGlobals();
});

describe("isSpertoConfigured", () => {
  it("is false when either env var is missing", () => {
    delete process.env.SPERTO_API_KEY;
    expect(isSpertoConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    expect(isSpertoConfigured()).toBe(true);
  });
});

describe("spertoEmailExists", () => {
  it("sends a raw JSON body with the three fields their endpoint reads", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", name: "Asha Rao" }));

    await spertoEmailExists("asha@futeservices.com");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api_get_details_of_customer.php`);
    // A form-encoded body is silently ignored by their server, so the
    // Content-Type is load-bearing, not decoration.
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      api_key: "test-key",
      id: "asha@futeservices.com",
      type: "sales_manager_email",
    });
  });

  // toMatchObject, not toEqual: a success also carries the parsed `body`, so
  // callers that need more than the name (the Lead ID check reads the
  // customer's details out of it) don't have to ask twice.
  it("accepts a known email and returns the name", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", name: "Asha Rao" }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toMatchObject({
      ok: true,
      name: "Asha Rao",
    });
  });

  it("finds a name nested under data", async () => {
    fetchMock.mockResolvedValue(reply({ status: 1, data: { full_name: "Asha Rao" } }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toMatchObject({
      ok: true,
      name: "Asha Rao",
    });
  });

  it("still accepts a success with no name in it", async () => {
    fetchMock.mockResolvedValue(reply({ status: "ok" }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toMatchObject({
      ok: true,
      name: null,
    });
  });

  it("rejects an unknown email — on a 200, which is how they say no", async () => {
    fetchMock.mockResolvedValue(reply({ status: "error", message: "No record found" }));
    const result = await spertoEmailExists("nobody@futeservices.com");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("treats a bad api_key as unavailable, not as a wrong email", async () => {
    // Otherwise our own misconfiguration sends a staff member off to
    // double-check an address that was fine all along.
    fetchMock.mockResolvedValue(reply({ status: "error", message: "Invalid api_key" }));
    const result = await spertoEmailExists("asha@futeservices.com");
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("is unavailable, not not_found, when Sperto is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await spertoEmailExists("asha@futeservices.com");
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("is unavailable on a PHP error page rather than parsing it as a rejection", async () => {
    fetchMock.mockResolvedValue(reply(null, { text: "<b>Fatal error</b>" }));
    const result = await spertoEmailExists("asha@futeservices.com");
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("is unavailable when there are no credentials at all", async () => {
    delete process.env.SPERTO_BASE_URL;
    const result = await spertoEmailExists("asha@futeservices.com");
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never leaks the api_key back out through an echoed error", async () => {
    fetchMock.mockResolvedValue(reply({ status: "error", message: "bad request test-key" }));
    const result = await spertoEmailExists("asha@futeservices.com");
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("accepts a success that arrives with a non-200 status", async () => {
    // Their host does not use status codes meaningfully — this endpoint's
    // neighbour answers {"status":"success"} at HTTP 500. Gating on res.ok
    // would refuse a staff member their CRM had just vouched for.
    fetchMock.mockResolvedValue(reply({ status: "success", name: "Asha Rao" }, { status: 500 }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toMatchObject({
      ok: true,
      name: "Asha Rao",
    });
  });

  it("is unavailable on the empty-500 their endpoint is known to send", async () => {
    // Confirmed live: any `type` value makes api_get_details_of_customer.php
    // 500 with no body at all. That is their bug, so it must never be
    // reported to a staff member as "your email is wrong".
    fetchMock.mockResolvedValue(reply(null, { status: 500, text: "" }));
    const result = await spertoEmailExists("asha@futeservices.com");
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

/**
 * The customer's own door, one screen after the staff member's. Same endpoint
 * and same three outcomes — what matters is that only `not_found` blocks a
 * presentation, because the other one is Sperto's problem and there is a
 * customer already sitting in front of the screen.
 */
describe("spertoLeadExists", () => {
  it("asks for a lead, by the Lead ID that was typed", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", name: "Rohit Sharma" }));

    await spertoLeadExists("985038");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api_get_details_of_customer.php`);
    expect(JSON.parse(init.body)).toEqual({
      api_key: "test-key",
      id: "985038",
      type: "lead",
    });
  });

  it("hands the body back so the customer's name can be lifted out of it", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", name: "Rohit Sharma" }));
    const result = await spertoLeadExists("985038");
    expect(result).toMatchObject({ ok: true, name: "Rohit Sharma" });
    expect(result.body).toMatchObject({ name: "Rohit Sharma" });
  });

  it("rejects a Lead ID they do not have — the one outcome that blocks a session", async () => {
    fetchMock.mockResolvedValue(reply({ status: "error", message: "No record found" }));
    await expect(spertoLeadExists("000000")).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("is unavailable, not not_found, when Sperto is unreachable", async () => {
    // A CRM that is down must not be able to stop a presentation.
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(spertoLeadExists("985038")).resolves.toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});

/**
 * The Sales ID an email sign-in needs for IN/OUT (sales_manager_login) only
 * exists in Sperto's success body. Its shape is undocumented, so these hold
 * the places it is looked for, and that nothing is invented when it is absent.
 */
describe("the Sales ID in a staff lookup's success body", () => {
  it("is read from the top level", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", sales_manager_login: "PDPL0349" }));
    const check = await spertoEmailExists("asha@futeservices.com");
    expect(check).toMatchObject({ ok: true, salesId: "PDPL0349" });
  });

  it("is read from a data object", async () => {
    fetchMock.mockResolvedValue(
      reply({ status: "success", data: { name: "Asha Rao", login_id: "PDPL0350" } }),
    );
    const check = await spertoEmailExists("asha@futeservices.com");
    expect(check).toMatchObject({ ok: true, name: "Asha Rao", salesId: "PDPL0350" });
  });

  it("is read from the first row of a data array", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", data: [{ emp_code: 4471 }] }));
    const check = await spertoEmailExists("asha@futeservices.com");
    expect(check).toMatchObject({ ok: true, salesId: "4471" });
  });

  it("is null, not guessed, when the body carries none", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", data: { name: "Asha Rao" } }));
    const check = await spertoEmailExists("asha@futeservices.com");
    expect(check).toMatchObject({ ok: true, salesId: null });
  });
});
