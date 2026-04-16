import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idwInterpolate, ordinaryKrigingInterpolate } from "@patool/shared";
import { samplePasCollection, samplePatSeries, sampleSensorRecord } from "@patool/shared/fixtures";

import { App } from "./App";

type MockMap = {
  addControl: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  setPaintProperty: ReturnType<typeof vi.fn>;
  getCanvas: ReturnType<typeof vi.fn>;
  isStyleLoaded: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
};

const mockMaps: MockMap[] = [];

function createMockMap(): MockMap {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();

  const map: MockMap = {
    addControl: vi.fn(),
    on: vi.fn((event: string, maybeLayer: unknown, maybeHandler?: unknown) => {
      const handler = typeof maybeLayer === "function" ? maybeLayer : maybeHandler;
      if ((event === "load" || event === "styledata") && typeof handler === "function") {
        handler();
      }
    }),
    once: vi.fn((event: string, handler: unknown) => {
      if ((event === "load" || event === "styledata") && typeof handler === "function") {
        handler();
      }
    }),
    off: vi.fn(),
    remove: vi.fn(),
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, source: { type: string }) => {
      if (source.type === "geojson") {
        const geojsonSource = {
          ...source,
          setData: vi.fn(),
        };
        sources.set(id, geojsonSource);
        return;
      }

      if (source.type === "image") {
        const imageSource = {
          ...source,
          updateImage: vi.fn(),
        };
        sources.set(id, imageSource);
        return;
      }

      sources.set(id, source);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.set(layer.id, layer);
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    setPaintProperty: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    isStyleLoaded: vi.fn(() => true),
    setStyle: vi.fn(),
    resize: vi.fn(),
    getBounds: vi.fn(() => ({
      getWest: () => -123,
      getEast: () => -121,
      getSouth: () => 46,
      getNorth: () => 48,
    })),
  };

  return map;
}

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(function MockMapConstructor() {
    const map = createMockMap();
    mockMaps.push(map);
    return map;
  });
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockMaps.length = 0;
    window.history.pushState({}, "", "/");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,test");
    vi.stubGlobal("ResizeObserver", class MockResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal("Worker", class MockWorker {
      onmessage: ((event: MessageEvent<{ data: unknown }>) => void) | null = null;

      postMessage = vi.fn((message: {
        jobId: number;
        method: "idw" | "kriging";
        points: Array<{ x: number; y: number; value: number }>;
        bounds: { west: number; east: number; south: number; north: number };
        gridWidth: number;
        gridHeight: number;
        idwPower: number;
      }) => {
        const grid = message.method === "idw"
          ? idwInterpolate(message.points, message.gridWidth, message.gridHeight, message.bounds, message.idwPower)
          : ordinaryKrigingInterpolate(message.points, message.gridWidth, message.gridHeight, message.bounds);

        this.onmessage?.({
          data: {
            jobId: message.jobId,
            ok: true,
            durationMs: 1,
            result: {
              ...grid,
              values: grid.values.buffer.slice(0),
            },
          },
        } as MessageEvent);
      });

      terminate = vi.fn();
    });
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

  it("renders the map heatmap overlay lifecycle", async () => {
    window.history.pushState({}, "", "/map");
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Heatmap")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Heatmap"));

    await waitFor(() => {
      const map = mockMaps.at(-1);
      expect(map?.addSource).toHaveBeenCalledWith(
        "heatmap-source",
        expect.objectContaining({ type: "image" }),
      );
      expect(map?.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "heatmap-layer", type: "raster" }),
        expect.anything(),
      );
      expect(map?.setPaintProperty).toHaveBeenCalledWith("sensors-circles", "circle-opacity", 0.35);
    });

    await user.click(screen.getByText("Markers"));

    await waitFor(() => {
      const map = mockMaps.at(-1);
      expect(map?.removeLayer).toHaveBeenCalledWith("heatmap-layer");
      expect(map?.removeSource).toHaveBeenCalledWith("heatmap-source");
    });
  });
});
