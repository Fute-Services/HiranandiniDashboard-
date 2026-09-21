/**
 * Signed session payload, verified server-side on every request that gates on
 * it — replaces trusting a plain `futeservices_auth=1` cookie, which anyone
 * could set by hand.
 *
 * A payload is `{ email, role, name, exp, deviceId? }`.
 *
 * `deviceId` is which registered device this session was started on, for the
 * passwordless (device-mode) staff login. Absent on password logins, and on
 * every token minted before devices existed — which is why it is optional:
 * widening the payload is purely additive, so tokens already in the wild keep
 * verifying instead of every user being signed out on deploy. It is the only
 * device claim in the system that is signed, so anything server-side that acts
 * on "which screen is this" must read it from here rather than from a request
 * body, or a staff member could open a session against someone else's device.
 *
 * Uses Web Crypto (`crypto.subtle`) rather than Node's `crypto` module. Under
 * Next.js that was so the same code could run in both the Edge middleware
 * runtime and Node route handlers; it stays because these tokens are already
 * in circulation and a different primitive would invalidate every one of them.
 * `crypto`, `btoa` and `atob` are all globals in Node 18+.
 */

function toBase64Url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const str = atob(padded);
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSessionToken(payload, secret) {
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${toBase64Url(sig)}`;
}

export async function verifySessionToken(token, secret) {
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
