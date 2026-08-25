import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth";

/**
 * There is no landing page any more — the app is a sign-in-and-present tool,
 * so the root just hands off to the login, which in turn bounces an already
 * signed-in user to their own area (see proxy.ts).
 */
export default function Home() {
  redirect(LOGIN_PATH);
}
