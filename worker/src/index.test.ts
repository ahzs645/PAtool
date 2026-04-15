import { describe, expect, it } from "vitest";

import { samplePatSeries } from "@patool/shared/fixtures";

import { createApp } from "./index";

describe("worker api", () => {
  const app = createApp();

  it("serves fixture-backed pas data", async () => {
    const response = await app.request("/api/pas");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { records: unknown[] };
    expect(payload.records.length).toBeGreaterThan(0);
  });

  it("runs qc and soh endpoints", async () => {
    const qcResponse = await app.request("/api/qc/hourly-ab", {
      method: "POST",
      body: JSON.stringify({ series: samplePatSeries, removeOutOfSpec: true }),
      headers: { "content-type": "application/json" }
    });
    const qcPayload = (await qcResponse.json()) as { flaggedPoints: number };
    expect(qcPayload.flaggedPoints).toBeGreaterThan(0);

    const sohResponse = await app.request("/api/soh/index", {
      method: "POST",
      body: JSON.stringify({ series: samplePatSeries }),
      headers: { "content-type": "application/json" }
    });
    const sohPayload = (await sohResponse.json()) as { index: number };
    expect(sohPayload.index).toBeGreaterThan(0);
  });
});
