import { describe, expect, it } from "vitest";
import { blamesApiKey, readSpertoBody } from "./sperto-response.js";

/**
 * The whole point of this module is that **the HTTP status is not evidence**.
 * Sperto's host answers 200 for rejections, and the device-usage endpoint has
 * been seen answering 500 with a perfectly good success body — so a real
 * success and a real failure are only ever distinguishable by what is in the
 * body. These are the cases that would otherwise be read backwards.
 */

/** Their server labels JSON as text/html, and the status is whatever it is. */
function reply(text, status = 200) {
  return new Response(text, { status, headers: { "Content-Type": "text/html" } });
}

describe("status codes are not the signal", () => {
  it("reads a success out of a 200", async () => {
    const r = await readSpertoBody(reply(JSON.stringify({ status: "success" })), "k");
    expect(r).toMatchObject({ ok: true });
  });

  it("reads a success out of a 500, which this host really does send", async () => {
    // api_record_device_usage.php answers {"status":"success"} at HTTP 500.
    // Gating on res.ok would have thrown this away as a failure.
    const r = await readSpertoBody(reply(JSON.stringify({ status: "success" }), 500), "k");
    expect(r).toMatchObject({ ok: true });
  });

  it("reads a rejection out of a 200, which is how they say no", async () => {
    const r = await readSpertoBody(
      reply(JSON.stringify({ status: "error", message: "No record found" })),
      "k",
    );
    expect(r).toMatchObject({ ok: false, reason: "rejected", message: "No record found" });
  });
});

describe("bodies that cannot be trusted", () => {
  it("an empty body is unreadable, not a rejection", async () => {
    // The documented api_get_details_of_customer.php bug: HTTP 500, no body
    // at all. Reading that as "no such customer" would reject valid people.
    const r = await readSpertoBody(reply("", 500), "k");
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
    expect(r.message).toMatch(/empty/i);
  });

  it("a PHP error page is unreadable, not a rejection", async () => {
    const r = await readSpertoBody(reply("<b>Fatal error</b>"), "k");
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("a JSON array is unreadable — the caller expects an object", async () => {
    const r = await readSpertoBody(reply("[1,2,3]"), "k");
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
  });
});

describe("what counts as a rejection", () => {
  for (const status of ["error", "fail", "failure", "no", "false", "0", 0, false]) {
    it(`treats status ${JSON.stringify(status)} as a rejection`, async () => {
      const r = await readSpertoBody(reply(JSON.stringify({ status })), "k");
      expect(r).toMatchObject({ ok: false, reason: "rejected" });
    });
  }

  it("treats a body with no status field at all as success", async () => {
    // We have only ever been shown error bodies; a success shape that simply
    // omits `status` is likelier than one that means "no" in a word we have
    // not seen. Documented as an open question with the client.
    const r = await readSpertoBody(reply(JSON.stringify({ name: "Rohit Sharma" })), "k");
    expect(r).toMatchObject({ ok: true });
  });
});

describe("the api_key never comes back out", () => {
  it("is stripped from an echoed error body", async () => {
    const r = await readSpertoBody(
      reply(JSON.stringify({ status: "error", message: "bad request secret-key" })),
      "secret-key",
    );
    expect(JSON.stringify(r)).not.toContain("secret-key");
  });

  it("is stripped from an unparseable body before it reaches a log", async () => {
    const r = await readSpertoBody(reply("Fatal error near secret-key"), "secret-key");
    expect(JSON.stringify(r)).not.toContain("secret-key");
  });
});

describe("blamesApiKey", () => {
  it("catches our own misconfiguration wearing a rejection's clothes", () => {
    expect(blamesApiKey("Invalid API Key")).toBe(true);
    expect(blamesApiKey("unauthorized")).toBe(true);
    expect(blamesApiKey("Forbidden")).toBe(true);
  });

  it("leaves a genuine not-found alone", () => {
    expect(blamesApiKey("No record found")).toBe(false);
    expect(blamesApiKey(undefined)).toBe(false);
  });
});
