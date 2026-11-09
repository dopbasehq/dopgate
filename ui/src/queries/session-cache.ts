import { useQueryCache } from "@pinia/colada";
import { PUBLIC } from "./keys";

type QueryCache = ReturnType<typeof useQueryCache>;

/**
 * Empties the query cache when the signed-in account changes or the
 * session ends, so nothing read as one account is shown to the next.
 * Entries a mounted screen still shows are emptied in place; the rest are
 * removed. Pre-session reads (sign-in methods) stay.
 */
export function clearQueryCache(cache: QueryCache = useQueryCache()): void {
  for (const entry of cache.getEntries()) {
    if (entry.key[0] === PUBLIC) continue;
    cache.cancel(entry);
    if (!entry.active) {
      cache.remove(entry);
      continue;
    }
    cache.setEntryState(entry, {
      status: "pending",
      data: undefined,
      error: null,
    });
    cache.invalidate(entry);
  }
}
