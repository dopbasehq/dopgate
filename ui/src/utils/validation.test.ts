import { describe, expect, it } from "vitest";
import { isValidEmail } from "./validation";

describe("isValidEmail", () => {
  it("accepts an address with a dot inside the domain", () => {
    for (const email of [
      "root@example.com",
      "  root@example.com  ",
      "first.last+tag@mail.example.co.id",
    ]) {
      expect(isValidEmail(email), email).toBe(true);
    }
  });

  it("rejects a missing part, a space, or a second @", () => {
    for (const email of [
      "",
      "root",
      "@example.com",
      "root@",
      "root@example",
      "root@.com",
      "root@example.",
      "root @example.com",
      "root@exa mple.com",
      "root@@example.com",
      "root@example.com@example.com",
    ]) {
      expect(isValidEmail(email), email).toBe(false);
    }
  });

  it("reads a long run of dots without slowing down", () => {
    const started = performance.now();
    expect(isValidEmail(`root@${".".repeat(100_000)} x`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
