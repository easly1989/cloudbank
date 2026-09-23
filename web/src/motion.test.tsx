import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { arrival, useArrival, useCountUp, type Arrival } from "./motion";

// matchMedia is not in jsdom; each test says whether the reader has asked for
// less movement, because that answer changes what these hooks are allowed to do.
function setReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

// requestAnimationFrame driven by the fake clock, so a count can be stepped
// through instead of waited on.
function useFakeFrames() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    Number(setTimeout(() => cb(performance.now()), 16)),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

describe("useCountUp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
    useFakeFrames();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the first value without counting to it", () => {
    const { result } = renderHook(() => useCountUp(4200));
    expect(result.current).toBe(4200);
  });

  it("lands exactly on the new value", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 1000 },
    });
    rerender({ v: 2000 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2000);
  });

  it("counts down as readily as up", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 2000 },
    });
    rerender({ v: -500 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(-500);
  });

  it("jumps straight there when the reader has asked for less movement", () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 1000 },
    });
    rerender({ v: 9999 });
    // No frames advanced: the value is already there.
    expect(result.current).toBe(9999);
  });
});

describe("useArrival", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("marks a row and then stops", () => {
    const { result, rerender } = renderHook(({ mark }) => useArrival(mark), {
      initialProps: { mark: null as Arrival | null },
    });
    expect(result.current).toBeNull();

    rerender({ mark: arrival(7) });
    expect(result.current).toBe(7);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBeNull();
  });

  it("marks the same row again when it is saved again", () => {
    const first = { id: 7, at: 1 };
    const { result, rerender } = renderHook(({ mark }) => useArrival(mark), {
      initialProps: { mark: first as Arrival | null },
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBeNull();

    // Same row, new stamp: a second save is a second arrival, and the stamp is
    // what tells them apart.
    rerender({ mark: { id: 7, at: 2 } });
    expect(result.current).toBe(7);
  });
});
