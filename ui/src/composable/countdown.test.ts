import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountController } from "~/tests/mount-controller";
import { useCountdown } from "./countdown";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useCountdown", () => {
  it("ticks down once a second and stops at zero", () => {
    const { controller: wait } = mountController(useCountdown);
    wait.start(3);
    expect(wait.seconds.value).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(wait.seconds.value).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(wait.seconds.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts over when started again", () => {
    const { controller: wait } = mountController(useCountdown);
    wait.start(10);
    vi.advanceTimersByTime(4000);
    wait.start(60);
    expect(wait.seconds.value).toBe(60);
    vi.advanceTimersByTime(1000);
    expect(wait.seconds.value).toBe(59);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("catches up after the tab slept", () => {
    const { controller: wait } = mountController(useCountdown);
    wait.start(60);
    // The clock moves on, but no tick ran in between.
    vi.setSystemTime(Date.now() + 45_000);
    vi.advanceTimersByTime(1000);
    expect(wait.seconds.value).toBe(14);
  });

  it("does not run for a wait of zero", () => {
    const { controller: wait } = mountController(useCountdown);
    wait.start(0);
    expect(wait.seconds.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when asked and when the component goes away", () => {
    const { controller: wait, unmount } = mountController(useCountdown);
    wait.start(30);
    wait.stop();
    expect(wait.seconds.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    wait.start(30);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
