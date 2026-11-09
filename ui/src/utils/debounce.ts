import { onScopeDispose, ref, watch, type Ref, type WatchSource } from "vue";

/**
 * A copy of `source` that only catches up after it has been still for
 * `delay` ms, for search fields that query the server.
 */
export function useDebounced<T>(
  source: WatchSource<T>,
  initial: T,
  delay = 300,
): Ref<T> {
  const value = ref(initial) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(source, (next) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      value.value = next;
    }, delay);
  });
  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });
  return value;
}
