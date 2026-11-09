import { computed, ref } from "vue";
import { useInfiniteQuery } from "@pinia/colada";
import { errorMessage } from "~/services/api";
import { verifyAuditChain, type AuditFilters } from "~/services/admin.api";
import type { AuditEvent, AuditVerification } from "~/services/types";
import { auditEventsQuery } from "~/queries/admin";
import { useDebounced } from "~/utils/debounce";

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

/**
 * Audit log controller: every change on the server, newest first, a page
 * at a time. Filter by action and by actor (id or label). Rows expand to
 * show their metadata. "Verify chain" checks the hash chain end to end.
 */
export function useAuditController() {
  const action = ref("");
  const actor = ref("");
  const actionQuery = useDebounced(action, "");
  const actorQuery = useDebounced(actor, "");

  const filters = computed<AuditFilters>(() => ({
    action: actionQuery.value.trim(),
    actor: actorQuery.value.trim(),
  }));

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

  const expanded = ref(new Set<string>());
  function toggle(id: string): void {
    const next = new Set(expanded.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded.value = next;
  }

  function clearFilters(): void {
    action.value = "";
    actor.value = "";
  }

  // Chain check
  const verifying = ref(false);
  const verification = ref<ReturnType<typeof describeVerification> | null>(
    null,
  );
  const verifyError = ref<string | null>(null);

  async function verify(): Promise<void> {
    if (verifying.value) return;
    verifying.value = true;
    verifyError.value = null;
    verification.value = null;
    try {
      verification.value = describeVerification(await verifyAuditChain());
    } catch (cause) {
      verifyError.value = errorMessage(cause, "Couldn't check the chain.");
    } finally {
      verifying.value = false;
    }
  }

  return {
    action,
    actor,
    filtered,
    events,
    loading,
    loadError,
    hasMore,
    loadingMore,
    reload,
    loadMore,
    expanded,
    toggle,
    clearFilters,
    verifying,
    verification,
    verifyError,
    verify,
  };
}
