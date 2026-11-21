import type { CapabilityValue } from "~/services/types";

/**
 * Capabilities as the editor shows them: one row per key, with a type, so a
 * person never has to write JSON. The rules match the server's: flat keys of
 * letters, digits, `_`, `.`, or `:`, and values that are text, a number,
 * true or false, or a list of text, 4 KB at most.
 */

export type CapabilityType = "text" | "number" | "boolean" | "list";

export interface CapabilityRow {
  key: string;
  type: CapabilityType;
  /** Lists are one item per line; booleans are "true" or "false". */
  value: string;
}

export const CAPABILITY_TYPES: { value: CapabilityType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "True or false" },
  { value: "list", label: "List of text" },
];

const KEY = /^[A-Za-z0-9_.:]{1,64}$/;
const MAX_BYTES = 4096;
const MAX_LIST_ITEMS = 100;

export function rowsFrom(
  capabilities: Record<string, CapabilityValue>,
): CapabilityRow[] {
  return Object.entries(capabilities).map(([key, value]) => {
    if (Array.isArray(value))
      return { key, type: "list", value: value.join("\n") };
    if (typeof value === "number")
      return { key, type: "number", value: String(value) };
    if (typeof value === "boolean")
      return { key, type: "boolean", value: String(value) };
    return { key, type: "text", value };
  });
}

export function emptyRow(): CapabilityRow {
  return { key: "", type: "text", value: "" };
}

export type ParsedCapabilities =
  | { ok: true; value: Record<string, CapabilityValue> }
  | { ok: false; errors: Record<number, string>; message: string | null };

/** The rows as the API takes them, or what's wrong with each row. */
export function toCapabilities(rows: CapabilityRow[]): ParsedCapabilities {
  const value: Record<string, CapabilityValue> = {};
  const errors: Record<number, string> = {};
  rows.forEach((row, index) => {
    const key = row.key.trim();
    if (key === "" && row.value.trim() === "") return;
    if (!KEY.test(key)) {
      errors[index] = "Use 1 to 64 letters, digits, _, . or : for the key.";
      return;
    }
    if (key in value) {
      errors[index] = "This key is already used.";
      return;
    }
    switch (row.type) {
      case "number": {
        const number = Number(row.value.trim());
        if (row.value.trim() === "" || !Number.isFinite(number)) {
          errors[index] = "Enter a number.";
          return;
        }
        value[key] = number;
        break;
      }
      case "boolean":
        value[key] = row.value === "true";
        break;
      case "list": {
        const items = row.value
          .split("\n")
          .map((item) => item.trim())
          .filter((item) => item !== "");
        if (items.length > MAX_LIST_ITEMS) {
          errors[index] = "A list holds at most 100 items.";
          return;
        }
        value[key] = items;
        break;
      }
      default:
        value[key] = row.value;
    }
  });
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: null };
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) {
    return {
      ok: false,
      errors: {},
      message: "Capabilities must be 4 KB or less.",
    };
  }
  return { ok: true, value };
}
