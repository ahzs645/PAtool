import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataStatus, PasCollection, PatSeries } from "@patool/shared";
import { samplePasCollection, samplePatSeries } from "@patool/shared/fixtures";

import { getStaticJson } from "./staticApi";

describe("static API adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives distinct deterministic PAT series for different sensors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("example_pas.collection.json")) {
          return new Response(JSON.stringify(samplePasCollection));
        }
        if (url.includes("example_pat.series.json")) {
          return new Response(JSON.stringify(samplePatSeries));
        }
        return new Response("{}", { status: 404 });
      })
    );

    const first = await getStaticJson<PatSeries>("/api/pat?id=26059&aggregate=raw");
    const second = await getStaticJson<PatSeries>("/api/pat?id=26060&aggregate=raw");

    expect(first.meta.sensorId).toBe("26059");
    expect(second.meta.sensorId).toBe("26060");
    expect(first.points[0].pm25A).not.toBe(second.points[0].pm25A);
  });

  it("recovers from temporary static asset parse failures by reloading", async () => {
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Response("not-json");
        }
        return new Response(JSON.stringify(samplePasCollection));
      })
    );

    await expect(getStaticJson<PasCollection>("/api/pas")).rejects.toThrow();
    const status = await getStaticJson<DataStatus>("/api/status");

    expect(status.mode).toBe("static");
    expect(status.collectionSource).toBe("fixture");
    expect(requestCount).toBe(2);
  });

  it("reports static data provenance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("example_pas.collection.json")) {
          return new Response(JSON.stringify(samplePasCollection));
        }
        return new Response("{}", { status: 404 });
      })
    );

    const status = await getStaticJson<DataStatus>("/api/status");
    expect(status.mode).toBe("static");
    expect(status.collectionSource).toBe("fixture");
    expect(status.warnings[0]).toContain("Static mode");
  });
});
