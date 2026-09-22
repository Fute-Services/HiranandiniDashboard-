import { Router } from "express";
import {
  AUTH_COOKIE,
  EMAIL_COOKIE,
  NAME_COOKIE,
  ROLE_COOKIE,
  SESSION_ID_COOKIE,
} from "../lib/auth.js";
import { cookieOptions, withJsonErrors } from "../lib/api.js";
import { dropLeadsForStaff } from "../lib/store.js";
import { getViewer } from "../lib/viewer.js";

/** Clears the httpOnly session cookie — client JS can't clear it itself
 * (that's the whole point of httpOnly), so logout has to round-trip here —
 * and drops what this sitting left in the API's memory, so the rule the
 * browser side follows (nothing outlives the session, see
 * src/lib/sign-out.js) holds on this side too. */
export const logoutRouter = Router();

logoutRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    // Read before the cookies go: this is the signed token, so it is the one
    // trustworthy answer to "whose session is ending". Null when the cookie
    // is already gone or expired, which is an ordinary double sign-out and
    // must still clear the cookies below rather than fail.
    const viewer = await getViewer(req);
    if (viewer) dropLeadsForStaff(viewer.email);

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
  }),
);
