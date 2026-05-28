import { describe, expect, it } from "vitest";

import {
  ingestOpenAqCountries,
  ingestOpenAqInstruments,
  ingestOpenAqManufacturers,
  ingestOpenAqParameters,
  ingestOpenAqProviders,
  lookupCatalog,
} from "./openaqCatalog";

describe("OpenAQ catalog ingest", () => {
  it("ingests countries from v3 results payload", () => {
    const list = ingestOpenAqCountries({
      results: [{ id: 1, code: "US", name: "United States" }, { id: 2, code: "CA", name: "Canada" }],
    });
    expect(list).toHaveLength(2);
    expect(lookupCatalog(list).byId.get(1)?.code).toBe("US");
  });

  it("ingests instruments with manufacturer nesting", () => {
    const list = ingestOpenAqInstruments([
      { id: 5, name: "Sensor X", manufacturer: { id: 99, name: "Acme" } },
    ]);
    expect(list[0].manufacturerName).toBe("Acme");
  });

  it("ignores malformed rows", () => {
    const m = ingestOpenAqManufacturers([{ name: "no-id" }, { id: 1, name: "OK" }]);
    expect(m).toHaveLength(1);
  });

  it("parameters carry units", () => {
    const p = ingestOpenAqParameters({ results: [{ id: 2, name: "pm25", units: "ug/m3" }] });
    expect(p[0].units).toBe("ug/m3");
  });

  it("providers can include source type", () => {
    const p = ingestOpenAqProviders({ results: [{ id: 9, name: "Clarity", sourceType: "lcs" }] });
    expect(p[0].sourceType).toBe("lcs");
  });
});
