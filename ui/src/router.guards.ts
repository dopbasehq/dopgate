import type { RouteLocationNormalized, RouteLocationRaw } from "vue-router";
import { useAuthStore } from "~/stores/auth.store";

declare module "vue-router" {
  interface RouteMeta {
    /** Reachable without a session. */
    public?: boolean;
    /** Signed-in visitors are sent on to the console. */
    guestOnly?: boolean;
  }
}

/**
 * Decides every navigation:
 * 1. Ask once whether the server is set up. Until it is, every page sends
 *    you to `/setup`; after, `/setup` sends you on.
 * 2. Public pages need no session. Signed-in visitors skip the sign-in page.
 * 3. Other pages need a session. The page-load refresh is tried once, then
 *    it's the sign-in page, with the address you wanted kept.
 * 4. Members are signed in but this console is for admins: No access.
 */
export async function guard(
  to: RouteLocationNormalized,
): Promise<true | RouteLocationRaw> {
  const auth = useAuthStore();
  if (auth.initialized === null) await auth.loadBootstrapStatus();

  if (auth.initialized === false) {
    return to.name === "setup" ? true : { name: "setup" };
  }
  if (to.name === "setup" && auth.initialized === true) {
    return { name: "sign-in" };
  }

  if (to.meta.public) {
    if (to.meta.guestOnly && (await auth.restore())) return home();
    return true;
  }

  if (!(await auth.restore())) {
    return {
      name: "sign-in",
      query: to.fullPath === "/" ? {} : { redirect: to.fullPath },
    };
  }
  if (!auth.isAdmin) {
    return to.name === "no-access" ? true : { name: "no-access" };
  }
  if (to.name === "no-access") return { name: "users" };
  return true;
}

/** Where a signed-in account starts. */
export function home(): RouteLocationRaw {
  return useAuthStore().isAdmin ? { name: "users" } : { name: "no-access" };
}
