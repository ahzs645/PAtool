import { describe, expect, it } from "vitest";

import { detectWarmupEvents } from "./warmupDetection";

describe("warmup detection", () => {
  it("identifies a warmup transient at start", () => {
    // Big spike then settles to ~10
    const values = [50, 40, 30, 25, 20, 15, 12, 11, 10, 10, 10, 10, 10, 10];
    const r = detectWarmupEvents(values, { lookahead: 3, stabilityThreshold: 0.4, consecutive: 3 });
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events[0].startIndex).toBe(0);
  });

  it("produces a clean mask aligned to input", () => {
    const values = [50, 30, 20, 10, 10, 10, 10, 10];
    const r = detectWarmupEvents(values, { lookahead: 2, stabilityThreshold: 0.5, consecutive: 3 });
    expect(r.mask).toHaveLength(values.length);
    expect(r.cleaned).toHaveLength(values.length);
  });

  it("no warmup when series is already stable", () => {
    const values = new Array(20).fill(10) as Array<number | null>;
    const r = detectWarmupEvents(values, { stabilityThreshold: 0.1, consecutive: 3 });
    expect(r.events.length).toBeLessThanOrEqual(1);
  });
});
