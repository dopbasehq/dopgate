import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useInfiniteQuery } from "@pinia/colada";
import { errorMessage } from "~/services/api";
import { verifyAuditChain, type AuditFilters } from "~/services/admin.api";
import type { AuditEvent, AuditVerification } from "~/services/types";
import { auditEventsQuery } from "~/queries/admin";
import { useDebounced } from "~/utils/debounce";
import { chainLine as lineFor } from "~/utils/audit";

/** What a chain check found, in words. */
export function describeVerification(result: AuditVerification): {
  ok: boolean;
  title: string;
  detail: string;
} {
  const records = `${result.records} ${result.records === 1 ? "record" : "records"} checked`;
  if (result.ok) {
    const head = result.headSeq !== null ? `, head #${result.headSeq}` : "";
    const extra: string[] = [];
    if (result.legacy > 0)
      extra.push(`${result.legacy} older records have no chain`);
    if (result.unsequenced > 0)
      extra.push(`${result.unsequenced} not sequenced yet`);
    if (result.prunedSeq !== null)
      extra.push(`pruned up to #${result.prunedSeq}`);
    return {
      ok: true,
      title: "Chain intact",
      detail: `${records}${head}.${extra.length ? ` ${extra.join("; ")}.` : ""}`,
    };
  }
  if (result.broken) {
    return {
      ok: false,
      title: `Chain broken at #${result.broken.seq}`,
      detail: `${result.broken.reason} (event ${result.broken.id}). ${records}.`,
    };
  }
  if (result.anchor && result.anchor.status !== "matched") {
    return {
      ok: false,
      title: `Anchor ${result.anchor.status} at #${result.anchor.seq}`,
      detail: `${records}.`,
    };
  }
  return { ok: false, title: "Chain check failed", detail: `${records}.` };
}

const queryText = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Audit log controller: every change on the server, newest first, a page
 * at a time. Filter by action (exact) and by actor (ID or label); both
 * live in the address, so other pages can link to "what this user did".
 * A row opens the event in a drawer. "Verify chain" checks the hash chain
 * end to end, and the drawer says where the open record stands in it.
 */
export function useAuditController() {
  const route = useRoute();
  const router = useRouter();

  const action = ref(queryText(route.query.action));
  const actor = ref(queryText(route.query.actor));
  const actorQuery = useDebounced(actor, actor.value);

  const filters = computed<AuditFilters>(() => ({
    action: action.value.trim(),
    actor: actorQuery.value.trim(),
  }));

  // Keep the filters in the address, without adding history entries.
  watch(filters, (next) => {
    const query = { ...route.query };
    for (const key of ["action", "actor"] as const) {
      if (next[key]) query[key] = next[key];
      else delete query[key];
    }
    void router.replace({ query });
  });

  const feed = useInfiniteQuery(() => ({
    ...auditEventsQuery(filters.value),
    placeholderData: (previous) => previous,
  }));

  const events = computed<AuditEvent[]>(
    () => feed.data.value?.pages.flatMap((page) => page?.items ?? []) ?? [],
  );
  const loading = computed(
    () => feed.data.value === undefined && feed.error.value === null,
  );
  const loadingMore = ref(false);
  const moreError = ref<string | null>(null);
  const loadError = computed(() =>
    feed.error.value && !feed.isLoading.value
      ? errorMessage(feed.error.value, "Couldn't load the audit log.")
      : moreError.value,
  );
  const hasMore = computed(
    () =>
      !feed.isPlaceholderData.value &&
      (feed.data.value?.pages.at(-1)?.nextCursor ?? null) !== null,
  );
  const filtered = computed(
    () => filters.value.action !== "" || filters.value.actor !== "",
  );

  async function reload(): Promise<void> {
    moreError.value = null;
    await feed.refetch();
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loadingMore.value) return;
    loadingMore.value = true;
    moreError.value = null;
    try {
      await feed.loadNextPage({ throwOnError: true });
    } catch (cause) {
      moreError.value = errorMessage(cause, "Couldn't load more events.");
    } finally {
      loadingMore.value = false;
    }
  }

  function setAction(next: string | null): void {
    action.value = (next ?? "").trim();
  }

  function clearFilters(): void {
    action.value = "";
    actor.value = "";
  }

  // The drawer
  const selected = ref<AuditEvent | null>(null);
  function openEvent(event: AuditEvent): void {
    selected.value = event;
  }
  function closeEvent(): void {
    selected.value = null;
  }

  // Chain check
  const verifying = ref(false);
  const verificationResult = ref<AuditVerification | null>(null);
  const verification = computed(() =>
    verificationResult.value
      ? describeVerification(verificationResult.value)
      : null,
  );
  const verifyError = ref<string | null>(null);

  async function verify(): Promise<void> {
    if (verifying.value) return;
    verifying.value = true;
    verifyError.value = null;
    verificationResult.value = null;
    try {
      verificationResult.value = await verifyAuditChain();
    } catch (cause) {
      verifyError.value = errorMessage(cause, "Couldn't check the chain.");
    } finally {
      verifying.value = false;
    }
  }

  /** Where one record stands in the chain, given the last check. */
  const chainLine = (event: AuditEvent) =>
    lineFor(event, verificationResult.value);

  return {
    action,
    actor,
    setAction,
    filtered,
    events,
    loading,
    loadError,
    hasMore,
    loadingMore,
    reload,
    loadMore,
    clearFilters,
    selected,
    openEvent,
    closeEvent,
    verifying,
    verification,
    verifyError,
    verify,
    chainLine,
  };
}
