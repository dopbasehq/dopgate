import type { PiniaColadaOptions } from "@pinia/colada";

/** How long a read counts as fresh before a screen asks again. */
export const FRESH_FOR = 5_000;

/** How long data no screen uses stays in memory. */
export const KEEP_UNUSED_FOR = 5 * 60_000;

/** Defaults for every query, shared by `main.ts` and the tests. */
export const piniaColadaOptions: PiniaColadaOptions = {
  queryOptions: {
    staleTime: FRESH_FOR,
    gcTime: KEEP_UNUSED_FOR,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
};
