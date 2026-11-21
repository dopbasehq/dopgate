import { createApp } from "vue";
import { onTestFinished } from "vitest";
import { installQueryLayer } from "./pinia";

/**
 * Runs a controller in component setup and disposes it when the test ends.
 * The app gets the test's Pinia and the query layer, so controllers that
 * read through queries work as they do in the real app.
 */
export function mountController<T>(factory: () => T) {
  let controller!: T;
  const app = createApp({
    setup() {
      controller = factory();
      return () => null;
    },
  });
  installQueryLayer(app);
  app.mount(document.createElement("div"));

  let mounted = true;
  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    app.unmount();
  }

  onTestFinished(unmount);
  return { controller, unmount };
}

/** Lets pending promises and query fetches settle. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}
