/** The sidebar's pages. Each lives at `/<name>`. */
export type PageName =
  "users" | "templates" | "admins" | "settings" | "keys" | "audit";

export interface SidebarSection {
  label: string;
  items: { name: PageName; label: string }[];
}

export const SIDEBAR: SidebarSection[] = [
  { label: "People", items: [{ name: "users", label: "Users" }] },
  { label: "Email", items: [{ name: "templates", label: "Templates" }] },
  {
    label: "Instance",
    items: [
      { name: "admins", label: "Admins" },
      { name: "settings", label: "Settings" },
      { name: "keys", label: "Signing keys" },
      { name: "audit", label: "Audit log" },
    ],
  },
];

const PAGE_NAMES = new Set<string>(
  SIDEBAR.flatMap((section) => section.items.map((item) => item.name)),
);

export function isPageName(value: string | undefined): value is PageName {
  return value !== undefined && PAGE_NAMES.has(value);
}
