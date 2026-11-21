import { describe, expect, it } from "vitest";
import { formatCountdown } from "./format";

describe("formatCountdown", () => {
  it.each([
    [60, "1:00"],
    [59, "0:59"],
    [5, "0:05"],
    [0, "0:00"],
    [3599, "59:59"],
    [-3, "0:00"],
  ])("shows %i seconds as %s", (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text);
  });
});
