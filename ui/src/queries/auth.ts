import { defineQueryOptions } from "@pinia/colada";
import { fetchAuthMethods, fetchMySessions } from "~/services/auth.api";
import { keys } from "./keys";

/** Sign-in options and branding. Public, so it survives sign-out. */
export const authMethodsQuery = defineQueryOptions({
  key: keys.public.methods,
  query: ({ signal }) => fetchAuthMethods(signal),
  staleTime: 60_000,
});

/** The signed-in account's own sessions. */
export const mySessionsQuery = defineQueryOptions({
  key: keys.account.sessions,
  query: ({ signal }) => fetchMySessions(signal),
});
