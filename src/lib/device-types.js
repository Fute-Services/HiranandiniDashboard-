/**
 * Which kind of screen a presentation runs on — chosen by the staff member at
 * "Start Session" rather than guessed from the browser's user-agent string,
 * which can only ever say "Chrome · Windows," not "Tab" vs. "TV" vs. "Kiosk."
 * Null for walk-in/legacy sessions where it was never asked.
 *
 * Its own module, with no imports at all, because both sides need it: the
 * device picker and the reports' device breakdown on the client, and the
 * device-usage route's body validation on the server. `src/lib/session.js`
 * re-exports it so client code can keep importing it from where it has always
 * been.
 *
 * This list is the single source of truth. Sperto's own numeric device_id per
 * type is a separate mapping keyed off these names
 * (server/lib/sperto-device-usage.js), so adding one here means adding one
 * there too.
 */
export const DEVICE_TYPES = ["Tab", "TV", "Kiosk", "Laptop"];
