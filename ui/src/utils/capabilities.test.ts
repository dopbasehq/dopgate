import { describe, expect, it } from "vitest";
import { rowsFrom, toCapabilities } from "./capabilities";

describe("capabilities", () => {
  it("round-trips every kind of value through rows", () => {
    const capabilities = {
      repo: "dopgate",
      max_files: 20,
      can_merge: false,
      labels: ["bot", "ci"],
    };
    const rows = rowsFrom(capabilities);
    expect(rows.map((row) => row.type)).toEqual([
      "text",
      "number",
      "boolean",
      "list",
    ]);
    expect(toCapabilities(rows)).toEqual({ ok: true, value: capabilities });
  });

  it("skips empty rows and trims list items", () => {
    expect(
      toCapabilities([
        { key: "", type: "text", value: "" },
        { key: "regions", type: "list", value: " id \n\n sg " },
      ]),
    ).toEqual({ ok: true, value: { regions: ["id", "sg"] } });
  });

  it("points at the row that's wrong", () => {
    const result = toCapabilities([
      { key: "bad key", type: "text", value: "x" },
      { key: "limit", type: "number", value: "lots" },
      { key: "ok", type: "text", value: "x" },
      { key: "ok", type: "text", value: "y" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual(["0", "1", "3"]);
    expect(result.errors[3]).toBe("This key is already used.");
  });

  it("keeps the whole object to 4 KB", () => {
    const result = toCapabilities([
      { key: "big", type: "text", value: "x".repeat(5000) },
    ]);
    expect(result).toEqual({
      ok: false,
      errors: {},
      message: "Capabilities must be 4 KB or less.",
    });
  });
});
