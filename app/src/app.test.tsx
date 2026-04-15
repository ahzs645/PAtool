import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { samplePasCollection, samplePatSeries, sampleSensorRecord } from "@patool/shared/fixtures";

import { App } from "./App";

vi.mock("maplibre-gl", () => {
  const Map = vi.fn().mockImplementation(() => ({
    addControl: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    remove: vi.fn(),
    getSource: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    isStyleLoaded: vi.fn(() => true),
    setStyle: vi.fn(),
  }));
  return {
    default: {
      Map,
      NavigationControl: vi.fn(),
      GeolocateControl: vi.fn(),
      Popup: vi.fn().mockImplementation(() => ({
        setLngLat: vi.fn().mockReturnThis(),
        setHTML: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
      })),
    },
  };
});

vi.mock("echarts-for-react/lib/core", () => ({
  default: () => <div data-testid="echart" />
}));

describe("app", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/pas")) {
          return new Response(JSON.stringify(samplePasCollection));
        }
        if (url.includes("/api/pat")) {
          return new Response(JSON.stringify(samplePatSeries));
        }
        if (url.includes("/api/sensor")) {
          return new Response(JSON.stringify(sampleSensorRecord));
        }
        if (url.includes("/api/qc/hourly-ab")) {
          return new Response(JSON.stringify({ sensorId: "1001", totalPoints: 12, flaggedPoints: 2, removedPoints: 2, status: "warning", issues: [], cleanedSeries: samplePatSeries }));
        }
        if (url.includes("/api/soh/index")) {
          return new Response(JSON.stringify({ sensorId: "1001", index: 82.4, status: "good", metrics: [{ date: "2026-04-12", pctReporting: 100, pctValid: 83.3, pctDataCompleteness: 83.3, meanAbsoluteChannelDelta: 0.8, channelAgreementScore: 93.6, otherFitScore: 88 }] }));
        }
        return new Response(JSON.stringify({ ok: true }));
      })
    );
  });

  it("renders explorer data from the API surface", async () => {
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText("PAtool")).toBeInTheDocument();
        expect(screen.getByText("Browse synoptic PurpleAir coverage")).toBeInTheDocument();
        expect(screen.getByText("Visible sensors")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });
});
