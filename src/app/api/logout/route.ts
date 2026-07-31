import { NextResponse } from "next/server";
import { AUTH_COOKIE, EMAIL_COOKIE, NAME_COOKIE, ROLE_COOKIE, SESSION_ID_COOKIE } from "@/lib/auth";

/** Clears the httpOnly session cookie — client JS can't clear it itself
 * (that's the whole point of httpOnly), so logout has to round-trip here. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  const expired = { path: "/", maxAge: 0, sameSite: "lax" as const };
  res.cookies.set(AUTH_COOKIE, "", { ...expired, httpOnly: true });
  res.cookies.set(ROLE_COOKIE, "", expired);
  res.cookies.set(NAME_COOKIE, "", expired);
  res.cookies.set(EMAIL_COOKIE, "", expired);
  res.cookies.set(SESSION_ID_COOKIE, "", expired);
  return res;
}
