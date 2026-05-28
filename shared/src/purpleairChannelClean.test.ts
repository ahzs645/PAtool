import { describe, expect, it } from "vitest";

import { cleanPurpleairAB } from "./purpleairChannelClean";

describe("PurpleAir A/B channel cleaning", () => {
  it("averages agreeing channels and flags disagreeing ones", () => {
    const r = cleanPurpleairAB([
      { timestamp: "t0", a: 10, b: 11 },
      { timestamp: "t1", a: 5, b: 50 },
      { timestamp: "t2", a: null, b: 12 },
    ]);
    expect(r.flagged).toBe(1);
    expect(r.pm25Cleaned[0].value).toBeCloseTo(10.5, 6);
    expect(r.pm25Cleaned[1].value).toBeNull();
    expect(r.pm25Cleaned[2].value).toBe(12);
  });

  it("zeros the column when a channel fails most of deployment", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ timestamp: `t${i}`, a: 10, b: null }));
    const r = cleanPurpleairAB(rows, { maxBadPercent: 0.5 });
    expect(r.pm25Cleaned.every((p) => p.value === null)).toBe(true);
  });
});
