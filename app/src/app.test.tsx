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
  getZoom: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
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

      if (source.type === "canvas") {
        const canvasSource = {
          ...source,
          setCoordinates: vi.fn(),
          play: vi.fn(),
          pause: vi.fn(),
        };
        sources.set(id, canvasSource);
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
    fitBounds: vi.fn(),
    getBounds: vi.fn(() => ({
      getWest: () => -123,
      getEast: () => -121,
      getSouth: () => 46,
      getNorth: () => 48,
    })),
    getZoom: vi.fn(() => 4),
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

vi.mock("./components/EChart", () => ({
  EChart: () => <div data-testid="echart" />
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
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
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
        krigingMaxNeighbors?: number;
        krigingTileSize?: number;
      }) => {
        const grid = message.method === "idw"
          ? idwInterpolate(message.points, message.gridWidth, message.gridHeight, message.bounds, message.idwPower)
          : ordinaryKrigingInterpolate(
            message.points,
            message.gridWidth,
            message.gridHeight,
            message.bounds,
            message.krigingMaxNeighbors,
            message.krigingTileSize,
          );

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
        const decodedUrl = decodeURIComponent(url);
        if (decodedUrl.includes("/api/airfuse/proxy?path=index.json")) {
          const geojsonPath = "fusion/PM25/2024/03/01/00/Fusion_PM25_NAQFC_2024-03-01T00Z.geojson";
          const csvPath = "fusion/PM25/2024/03/01/00/Fusion_PM25_NAQFC_2024-03-01T00Z_AirNow_CV.csv";
          const ncPath = "fusion/PM25/2024/03/01/00/Fusion_PM25_NAQFC_2024-03-01T00Z.nc";
          return new Response(JSON.stringify({
            fusion: {
              PM25: {
                max_date: "2024-03-01T00:00:00",
                "2024": {
                  "03": {
                    "01": {
                      "00": {
                        "Fusion_PM25_NAQFC_2024-03-01T00Z.geojson": geojsonPath,
                        "Fusion_PM25_NAQFC_2024-03-01T00Z_AirNow_CV.csv": csvPath,
                        "Fusion_PM25_NAQFC_2024-03-01T00Z.nc": ncPath,
                      },
                    },
                  },
                },
              },
            },
          }));
        }
        if (decodedUrl.includes("Fusion_PM25_NAQFC_2024-03-01T00Z.geojson")) {
          return new Response(JSON.stringify({
            type: "FeatureCollection",
            description: "AirFuse test artifact",
            features: [
              {
                type: "Feature",
                properties: { Name: "0 to 10", AQIC: 5, OGR_STYLE: "BRUSH(fc:#009500)" },
                geometry: {
                  type: "Polygon",
                  coordinates: [[[-100, 40], [-99, 40], [-99, 41], [-100, 41], [-100, 40]]],
                },
              },
            ],
          }));
        }
        if (decodedUrl.includes("Fusion_PM25_NAQFC_2024-03-01T00Z_AirNow_CV.csv")) {
          return new Response("pm25,FUSED_aVNA\n10,11\n20,19\n");
        }
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
        expect.objectContaining({ type: "canvas", animate: false }),
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

  it("renders the config-driven modeling page", async () => {
    window.history.pushState({}, "", "/modeling");

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText("Config-driven exposure surfaces")).toBeInTheDocument();
        expect(screen.getByText("Observed PM2.5")).toBeInTheDocument();
        expect(screen.getByText("Hazard index")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it("renders the AirFuse static artifact viewer", async () => {
    window.history.pushState({}, "", "/airfuse");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("AirFuse surface viewer")).toBeInTheDocument();
      expect(screen.getByText("GeoJSON surface")).toBeInTheDocument();
      expect(screen.getByText("Validation CSV")).toBeInTheDocument();
    });

    const map = mockMaps.at(-1);
    expect(map?.addSource).toHaveBeenCalledWith(
      "airfuse-surface",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(map?.fitBounds).toHaveBeenCalled();
  });
});
