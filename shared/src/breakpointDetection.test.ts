import { describe, expect, it } from "vitest";

import { detectBreakpoints, type BreakpointSeriesPoint } from "./breakpointDetection";

describe("detectBreakpoints", () => {
  it("returns zero breakpoints on a noisy single linear trend", () => {
    const series: BreakpointSeriesPoint[] = Array.from({ length: 80 }, (_, i) => ({
      x: i,
      y: i * 0.5 + (i % 3 === 0 ? 0.1 : -0.1),
    }));
    const result = detectBreakpoints(series, { maxBreakpoints: 3 });
    expect(result.breakpoints).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(Math.abs(result.segments[0].slope - 0.5)).toBeLessThan(0.05);
  });

  it("recovers a single change-point in a piecewise-linear series", () => {
    const series: BreakpointSeriesPoint[] = [];
    for (let i = 0; i < 40; i += 1) series.push({ x: i, y: i });
    for (let i = 40; i < 80; i += 1) series.push({ x: i, y: 40 + (80 - i)});
    const result = detectBreakpoints(series, { maxBreakpoints: 2, minSegmentSize: 8 });
    expect(result.breakpoints.length).toBeGreaterThanOrEqual(1);
    // breakpoint reported as 1-based index near the true change at 40
    const closest = result.breakpoints.reduce(
      (acc, bp) => (Math.abs(bp - 41) < Math.abs(acc - 41) ? bp : acc),
      result.breakpoints[0],
    );
    expect(Math.abs(closest - 41)).toBeLessThanOrEqual(5);
  });
});
