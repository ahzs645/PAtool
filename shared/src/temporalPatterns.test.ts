import { describe, expect, it } from "vitest";

import { byDayOfWeek, byHourOfDay, byMonthOfYear, comparisonPatterns } from "./temporalPatterns";

describe("temporal patterns", () => {
  it("averages by hour of day", () => {
    const values = [
      { timestamp: "2024-01-01T05:00:00Z", value: 10 },
      { timestamp: "2024-01-02T05:00:00Z", value: 20 },
      { timestamp: "2024-01-01T06:00:00Z", value: 30 },
    ];
    const hours = byHourOfDay(values);
    expect(hours[5].mean).toBe(15);
    expect(hours[5].count).toBe(2);
    expect(hours[6].mean).toBe(30);
    expect(hours[0].mean).toBeNull();
  });

  it("applies a UTC offset when bucketing hours", () => {
    const values = [{ timestamp: "2024-01-01T00:00:00Z", value: 42 }];
    expect(byHourOfDay(values, -8)[16].mean).toBe(42); // 00Z -> 16:00 the prior day at UTC-8
  });

  it("averages by day of week", () => {
    // 2024-01-01 is a Monday (getUTCDay() === 1).
    const monday = byDayOfWeek([{ timestamp: "2024-01-01T12:00:00Z", value: 8 }]);
    expect(monday[1].mean).toBe(8);
    expect(monday[1].label).toBe("Mon");
  });

  it("averages by month of year", () => {
    const months = byMonthOfYear([
      { timestamp: "2024-03-10T00:00:00Z", value: 4 },
      { timestamp: "2024-03-20T00:00:00Z", value: 6 },
    ]);
    expect(months[2].mean).toBe(5); // March
    expect(months[2].label).toBe("Mar");
  });

  it("builds paired comparison patterns", () => {
    const a = [{ timestamp: "2024-01-01T05:00:00Z", value: 10 }];
    const b = [{ timestamp: "2024-01-01T05:00:00Z", value: 20 }];
    const patterns = comparisonPatterns(a, b);
    expect(patterns.hourOfDay.a[5].mean).toBe(10);
    expect(patterns.hourOfDay.b[5].mean).toBe(20);
  });
});
