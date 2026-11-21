import { createApp, type App } from "vue";
import { createPinia, getActivePinia, setActivePinia, type Pinia } from "pinia";
import { PiniaColada } from "@pinia/colada";
import { piniaColadaOptions } from "~/queries/options";

/**
 * Makes a new active Pinia with the query layer installed, as `main.ts`
 * does. `setup.ts` calls it before every test, so each one starts with an
 * empty query cache and empty stores.
 */
export function freshPinia(): Pinia {
  const pinia = createPinia();
  createApp({}).use(pinia).use(PiniaColada, piniaColadaOptions);
  setActivePinia(pinia);
  return pinia;
}

/** Installs the active Pinia and the query layer on a test app. */
export function installQueryLayer(app: App): App {
  const pinia = getActivePinia() ?? freshPinia();
  return app.use(pinia).use(PiniaColada, piniaColadaOptions);
}
