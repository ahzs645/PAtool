import { describe, expect, it } from "vitest";

import { detectWarmupEvents, warmupIndexSet } from "./warmupDetection";

const HOURLY = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1, i)).toISOString());

describe("detectWarmupEvents", () => {
  it("flags the first sample as a restart", () => {
    const events = detectWarmupEvents(HOURLY(10), { warmupSampleCount: 3 });
    expect(events).toHaveLength(1);
    expect(events[0].restartIndex).toBe(0);
    expect(events[0].warmupIndices).toEqual([0, 1, 2]);
  });

  it("flags every gap larger than restartGapMinutes", () => {
    const timestamps = [
      "2025-01-01T00:00:00Z",
      "2025-01-01T01:00:00Z",
      "2025-01-01T08:00:00Z",   // 7h gap → restart
      "2025-01-01T09:00:00Z",
    ];
    const events = detectWarmupEvents(timestamps, { restartGapMinutes: 60, warmupSampleCount: 2 });
    expect(events.map((event) => event.restartIndex)).toEqual([0, 2]);
  });

  it("supports a duration-based warmup window", () => {
    const events = detectWarmupEvents(HOURLY(10), { warmupMinutes: 150 });
    expect(events[0].warmupIndices).toEqual([0, 1, 2]); // 0, 60, 120 min ≤ 150
  });

  it("emits a flat index set for masking", () => {
    const set = warmupIndexSet(HOURLY(5), { warmupSampleCount: 2 });
    expect([...set].sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
