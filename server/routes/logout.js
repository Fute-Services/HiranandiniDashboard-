import { Router } from "express";
import {
  AUTH_COOKIE,
  EMAIL_COOKIE,
  NAME_COOKIE,
  ROLE_COOKIE,
  SESSION_ID_COOKIE,
} from "../lib/auth.js";
import { cookieOptions } from "../lib/api.js";

/** Clears the httpOnly session cookie — client JS can't clear it itself
 * (that's the whole point of httpOnly), so logout has to round-trip here. */
export const logoutRouter = Router();

logoutRouter.post("/", (req, res) => {
  // clearCookie only matches a cookie whose path/sameSite/secure agree with
  // the ones it was set under, so these have to be the same options the login
  // route used — otherwise the browser keeps the original and the sign-out
  // silently does nothing.
  const expired = cookieOptions();
  res.clearCookie(AUTH_COOKIE, { ...expired, httpOnly: true });
  res.clearCookie(ROLE_COOKIE, expired);
  res.clearCookie(NAME_COOKIE, expired);
  res.clearCookie(EMAIL_COOKIE, expired);
  res.clearCookie(SESSION_ID_COOKIE, expired);
  res.json({ ok: true });
});
