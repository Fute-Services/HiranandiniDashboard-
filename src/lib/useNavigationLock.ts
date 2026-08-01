"use client";

import { useEffect, useState } from "react";

/**
 * How long a leave-this-screen action may keep its buttons locked before the
 * lock is treated as stuck and dropped. Long enough that a slow but working
 * navigation still reads as "in progress" rather than flickering back to
 * idle, short enough that a dead button doesn't outlast anyone's patience.
 */
const STUCK_AFTER_MS = 8000;

/**
 * The "this button is navigating away" lock, shared by every screen that
 * disables its controls while a sign-out or a route change is in flight.
 *
 * Drop-in for the `useState` those screens used to hold it in. The difference
 * is that this one can't get stuck, and a stuck one is the app's single most
 * common "the buttons stopped working, I had to reload" complaint. Every
 * screen set the flag and never cleared it, on the assumption that the
 * navigation unmounts the component and takes the state with it. That
 * assumption breaks in two ordinary ways:
 *
 * - `router.push()` can quietly not land. It fetches the next route over the
 *   network first, and on the kind of connection a showroom floor actually
 *   has, a dropped fetch leaves the user standing on the same page with every
 *   button disabled and no way back except a reload.
 * - A back/forward restore out of the bfcache hands the page back exactly as
 *   it was frozen — spinner still spinning, buttons still disabled — after a
 *   hard sign-out navigation. Nothing is in flight any more; the lock says
 *   otherwise.
 *
 * So the lock releases itself: immediately on a bfcache restore, and on a
 * watchdog for the navigation that never arrives. A navigation that does land
 * unmounts the hook and clears the timer with it, so nothing changes on the
 * happy path — this only ever fires when the screen would otherwise be stuck.
 *
 * Callers keep their own `if (pending) return;` guard at the top of each
 * handler: that's what stops a double-click starting two navigations, and
 * it's a separate concern from the lock going stale.
 */
export function useNavigationLock<T extends string>() {
  const [pending, setPending] = useState<T | null>(null);

  useEffect(() => {
    if (pending === null) return;
    const release = () => setPending(null);
    const watchdog = window.setTimeout(release, STUCK_AFTER_MS);
    // `persisted` is what separates a bfcache restore from an ordinary first
    // paint — only the restore can be showing a lock left over from before.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) release();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearTimeout(watchdog);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pending]);

  return [pending, setPending] as const;
}
