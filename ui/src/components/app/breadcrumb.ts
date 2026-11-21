import type { RouteLocationRaw } from "vue-router";

/** One step back up the pages above the current one. */
export interface Breadcrumb {
  label: string;
  to: RouteLocationRaw;
}
