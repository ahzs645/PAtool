import { describe, expect, it } from "vitest";

import { applyImportMapping, inferImportMapping } from "./importMapping";

describe("ASDU / ASNAT standard-format import", () => {
  it("maps the ASDU standard-format columns", () => {
    const columns = ["timestamp(UTC)", "id(-)", "longitude(deg)", "latitude(deg)", "pm25(ug/m3)", "flagged(-)"];
    const mapping = inferImportMapping(columns, "asdu-standard");
    expect(mapping.timestamp).toBe("timestamp(UTC)");
    expect(mapping.sensorId).toBe("id(-)");
    expect(mapping.longitude).toBe("longitude(deg)");
    expect(mapping.latitude).toBe("latitude(deg)");
    expect(mapping.pollutant).toBe("pm25(ug/m3)");
    expect(mapping.qaFlag).toBe("flagged(-)");
  });

  it("applies the mapping to ASDU rows", () => {
    const columns = ["timestamp(UTC)", "id(-)", "longitude(deg)", "latitude(deg)", "pm25(ug/m3)"];
    const mapping = inferImportMapping(columns, "asdu-standard");
    const [row] = applyImportMapping(
      [{ "timestamp(UTC)": "2026-01-01T00:00:00Z", "id(-)": "s1", "longitude(deg)": "-122", "latitude(deg)": "47", "pm25(ug/m3)": "9.5" }],
      mapping,
    );
    expect(row.timestamp).toBe("2026-01-01T00:00:00Z");
    expect(row.sensorId).toBe("s1");
    expect(row.longitude).toBe(-122);
    expect(row.pollutant).toBe(9.5);
  });
});
