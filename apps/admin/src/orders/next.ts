// The guards of the pages and the routes of the orders screens: the session and the permission of the role, both on every
// request (a layout is not drawn again between pages, so each page asks).
import { redirect } from "next/navigation";
import { currentUser, FORBIDDEN_PATH, SIGN_IN_PATH } from "../auth/next.ts";
import type { SessionUser } from "../auth/service.ts";
import { canDo, type OrdersPermission } from "./access.ts";

/** For a page: no session goes to the sign-in page, a session without the right to the page that says so. */
export async function requireOrdersUser(anyOf: OrdersPermission[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(SIGN_IN_PATH);
  if (!anyOf.some((p) => canDo(user.role, p))) redirect(FORBIDDEN_PATH);
  return user;
}

/** For a layout: any signed-in person (each page of it names its own permission). */
export async function requireSignedIn(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}
