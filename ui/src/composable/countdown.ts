import { onScopeDispose, readonly, ref } from "vue";

/**
 * A countdown in whole seconds for a wait the server sets, such as how long
 * until a new code can be sent. It ticks once a second toward a deadline, so
 * a tab that slept shows the right number on its next tick. Stops by itself
 * at zero and when the component goes away.
 */
export function useCountdown() {
  const seconds = ref(0);
  let deadline = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function clear(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function tick(): void {
    seconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (seconds.value === 0) clear();
  }

  /** Counts down from `wait` seconds. Zero or less ends the countdown. */
  function start(wait: number): void {
    clear();
    if (!(wait > 0)) {
      seconds.value = 0;
      return;
    }
    deadline = Date.now() + wait * 1000;
    seconds.value = Math.ceil(wait);
    timer = setInterval(tick, 1000);
  }

  function stop(): void {
    clear();
    seconds.value = 0;
  }

  onScopeDispose(clear);

  return { seconds: readonly(seconds), start, stop };
}
