import { describe, expect, it } from "vitest";

import { externalChannelFit, internalChannelFit } from "./channelFit";

describe("channel fit diagnostics", () => {
  it("internalFit detects healthy A vs B channels", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ timestamp: `t${i}`, a: i + 1, b: i + 1.2 }));
    const r = internalChannelFit(pts);
    expect(r.fit.r2).toBeGreaterThan(0.95);
    expect(r.qualityPass).toBe(true);
  });

  it("externalFit fails quality when slope is off", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ timestamp: `t${i}`, reference: i + 1, pa: 2 * i + 5 }));
    const r = externalChannelFit(pts);
    expect(r.qualityPass).toBe(false);
  });
});
