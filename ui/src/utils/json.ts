export type JsonObject = Record<string, unknown>;

export type JsonParse =
  { ok: true; value: JsonObject } | { ok: false; error: string };

/**
 * Parses metadata typed into a JSON editor. Metadata is always a JSON
 * object; an empty field counts as `{}`.
 */
export function parseJsonObject(text: string): JsonParse {
  if (text.trim() === "") return { ok: true, value: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "";
    return {
      ok: false,
      error: detail
        ? `This is not valid JSON: ${detail}`
        : "This is not valid JSON.",
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Metadata must be a JSON object, like {}." };
  }
  return { ok: true, value: value as JsonObject };
}

/** Pretty-prints an object for the editor. */
export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

/** The most public metadata Dopgate accepts, in bytes of compact JSON. */
export const PUBLIC_METADATA_MAX_BYTES = 1024;

/** The size the server measures: the object as compact JSON, in bytes. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? {})).length;
}
