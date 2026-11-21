import type { InjectionKey } from "vue";

/** Lets `DgMenuItem` close the `DgMenu` it sits in once it's chosen. */
export const menuCloseKey: InjectionKey<() => void> = Symbol("dg-menu-close");
