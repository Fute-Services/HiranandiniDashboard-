import { Router } from "express";
import { withJsonErrors } from "../lib/api.js";
import { getViewer } from "../lib/viewer.js";

/**
 * "Who does the signed token say I am?" — the endpoint the client-side route
 * guards gate on (src/routes/guards.jsx).
 *
 * New in the move off Next.js. There, middleware verified the session token
 * on the server before a page was ever sent, so the browser never had to ask.
 * A client-rendered app has no such step: without this, the guards would have
 * only the plain `futeservices_role` cookie to read, which is client-writable
 * and exists purely so the UI can render a name.
 *
 * Read-only and cheap — no database, just an HMAC verification — because the
 * guards call it on every first paint.
 */
export const sessionRouter = Router();

sessionRouter.get(
  "/",
  withJsonErrors(async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.status(401).json({ error: "Not signed in" });
    // Deliberately not the whole payload: the client needs to know who this
    // is and what to draw, not when the token expires or which device it was
    // minted against.
    return res.json({ email: viewer.email, role: viewer.role, name: viewer.name });
  }),
);
