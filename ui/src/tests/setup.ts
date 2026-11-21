import { beforeEach } from "vitest";
import { freshPinia } from "./pinia";

/**
 * Node ships an experimental, file-backed `localStorage` that happy-dom
 * can't replace, so install an in-memory one on the test global.
 */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const storage = createStorage();
for (const target of [
  globalThis,
  (globalThis as unknown as { window?: unknown }).window,
]) {
  if (target == null) continue;
  Object.defineProperty(target, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

// Reset storage, stores and the query cache between tests.
beforeEach(() => {
  storage.clear();
  freshPinia();
});
