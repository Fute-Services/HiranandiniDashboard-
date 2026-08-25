import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSpertoConfigured, spertoEmailExists } from "./sperto";

/**
 * The login door now hangs entirely on this one call, and the ways it can be
 * read wrong are all quirks of *their* server rather than of ours: errors
 * arrive as HTTP 200, the body is labelled text/html, and a rejection that
 * blames the api_key must not be reported to a staff member as "your email is
 * wrong". Those are what these cover.
 */

const BASE = "https://sperto.example/_api";

/** Their server always answers 200 — the body is the only signal. */
function reply(body: unknown, init: { status?: number; text?: string } = {}) {
  const text = init.text ?? JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    // Labelled text/html despite being JSON, exactly as the real one does.
    headers: { "Content-Type": "text/html" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

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
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: "test-key",
      id: "asha@futeservices.com",
      type: "sales_manager_email",
    });
  });

  it("accepts a known email and returns the name", async () => {
    fetchMock.mockResolvedValue(reply({ status: "success", name: "Asha Rao" }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toEqual({
      ok: true,
      name: "Asha Rao",
    });
  });

  it("finds a name nested under data", async () => {
    fetchMock.mockResolvedValue(reply({ status: 1, data: { full_name: "Asha Rao" } }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toEqual({
      ok: true,
      name: "Asha Rao",
    });
  });

  it("still accepts a success with no name in it", async () => {
    fetchMock.mockResolvedValue(reply({ status: "ok" }));
    await expect(spertoEmailExists("asha@futeservices.com")).resolves.toEqual({
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
});
