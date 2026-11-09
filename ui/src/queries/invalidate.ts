import { useQueryCache, type EntryKey } from "@pinia/colada";
import type { AdminUser } from "~/services/types";
import { keys } from "./keys";

/**
 * Refreshes the cached reads a change affects, named after what changed.
 * Writes stay plain service calls; after the server confirms, they call
 * one of these. Every write is audited, so the audit feed refreshes too.
 * The returned promises never reject: a failed reload shows on the query.
 */
export function useInvalidate() {
  const cache = useQueryCache();

  const refresh = (...prefixes: EntryKey[]) =>
    Promise.allSettled([
      ...prefixes.map((key) => cache.invalidateQueries({ key })),
      cache.invalidateQueries({ key: keys.audit.root }),
    ]).then(() => undefined);

  return {
    /** A user changed: keep the server's copy and refresh the lists. */
    userChanged(user: AdminUser): Promise<void> {
      cache.setQueryData(keys.users.one(user.id), user);
      return refresh(["users", "list"], keys.users.sessions(user.id));
    },
    usersChanged: () => refresh(keys.users.root),
    templatesChanged: () => refresh(keys.templates.root),
    settingsChanged: () => refresh(keys.settings),
    signingKeysChanged: () => refresh(keys.signingKeys),
    accountChanged: () => refresh(keys.account.root),
  };
}
