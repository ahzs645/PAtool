import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildReferenceComparison, idwInterpolate, ordinaryKrigingInterpolate, pm25ToAqi } from "@patool/shared";
import { samplePasCollection, samplePatSeries, sampleSensorRecord } from "@patool/shared/fixtures";

import { App } from "./App";

type MockFn = ReturnType<typeof vi.fn>;
type MockMap = Record<string, MockFn | unknown> & {
  on: MockFn;
  once: MockFn;
  off: MockFn;
  getSource: MockFn;
  addSource: MockFn;
  removeSource: MockFn;
  addLayer: MockFn;
  getLayer: MockFn;
  removeLayer: MockFn;
  setPaintProperty: MockFn;
  setLayoutProperty: MockFn;
  fitBounds: MockFn;
};

const mockMaps: MockMap[] = [];

// Events the toolkit map waits on before it mounts layers; fire them at once.
const IMMEDIATE_MAP_EVENTS = new Set(["load", "style.load", "styledata", "render"]);

function createMockMap(): MockMap {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  const canvas = document.createElement("canvas");
  const container = document.createElement("div");
  const handler = () => ({ isEnabled: vi.fn(() => true), enable: vi.fn(), disable: vi.fn() });

  const map: MockMap = {
    addControl: vi.fn(),
    on: vi.fn((event: string, maybeLayer: unknown, maybeHandler?: unknown) => {
      const listener = typeof maybeLayer === "function" ? maybeLayer : maybeHandler;
      if (typeof maybeLayer === "function" && IMMEDIATE_MAP_EVENTS.has(event) && typeof listener === "function") {
        listener();
      }
    }),
    once: vi.fn((event: string, listener: unknown) => {
      if (IMMEDIATE_MAP_EVENTS.has(event) && typeof listener === "function") {
        listener();
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
    moveLayer: vi.fn(),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
    setFeatureState: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    getContainer: vi.fn(() => container),
    getStyle: vi.fn(() => ({ version: 8, sources: {}, layers: [] })),
    isStyleLoaded: vi.fn(() => true),
    isMoving: vi.fn(() => false),
    setStyle: vi.fn(),
    setProjection: vi.fn(),
    resize: vi.fn(),
    jumpTo: vi.fn(),
    flyTo: vi.fn(),
    zoomTo: vi.fn(),
    fitBounds: vi.fn(),
    triggerRepaint: vi.fn(),
    getBounds: vi.fn(() => ({
      getWest: () => -123,
      getEast: () => -121,
      getSouth: () => 46,
      getNorth: () => 48,
    })),
    getCenter: vi.fn(() => ({ lng: -122, lat: 47 })),
    getZoom: vi.fn(() => 4),
    getBearing: vi.fn(() => 0),
    getPitch: vi.fn(() => 0),
    boxZoom: handler(),
    doubleClickZoom: handler(),
  };

  return map;
}

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(function MockMapConstructor() {
    const map = createMockMap();
    mockMaps.push(map);
    return map;
  });
  const chain = () => ({
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    setDOMContent: vi.fn().mockReturnThis(),
    setMaxWidth: vi.fn().mockReturnThis(),
    setOffset: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    isOpen: vi.fn(() => false),
    getLngLat: vi.fn(() => ({ lng: 0, lat: 0 })),
    getElement: vi.fn(() => document.createElement("div")),
  });
  const Popup = vi.fn(function MockPopup() {
    return chain();
  });
  const Marker = vi.fn(function MockMarker() {
    return chain();
  });
  const runtime = { Map, Popup, Marker, addProtocol: vi.fn() };
  return { ...runtime, default: runtime };
});

vi.mock("echarts-for-react/lib/core", () => ({
  default: () => <div data-testid="echart" />
}));

vi.mock("./components/EChart", () => ({
  EChart: () => <div data-testid="echart" />
}));

describe("app", () => {
  afterEach(() => {
    // Unmount the previous full <App /> tree so DOM/queries don't accumulate
    // across tests — six stacked App trees otherwise make screen queries
    // ambiguous and slow, which intermittently times out the heaviest page.
    cleanup();
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
        if (url.includes("/api/reference/compare")) {
          const comparisonSeries = {
            ...samplePatSeries,
            points: samplePatSeries.points.filter((_, index) => index % 60 === 0).slice(0, 12),
          };
          const reference = {
            source: "airnow" as const,
            kind: "conditions" as const,
            label: "AirNow PM2.5 reference",
            latitude: samplePatSeries.meta.latitude ?? 47.61702,
            longitude: samplePatSeries.meta.longitude ?? -122.343761,
            siteId: "AIRNOW-TEST",
            sourceUrl: "https://www.airnow.gov/",
            attribution: "EPA AirNow test reference.",
            observations: comparisonSeries.points.map((point) => {
              const pm25 = point.pm25A === null ? null : Number((point.pm25A * 0.85 + 1).toFixed(1));
              return {
                timestamp: point.timestamp,
                parameter: "PM2.5" as const,
                pm25,
                aqi: pm25 === null ? null : pm25ToAqi(pm25),
                provenance: "official-reference" as const,
              };
            }),
          };
          return new Response(JSON.stringify(buildReferenceComparison(comparisonSeries, reference)));
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
        // The brand renders twice — once in the compact top bar, once in the
        // sidebar/drawer — so scope the assertion to the top bar.
        const topbar = screen.getByRole("banner", { name: "Application" });
        expect(within(topbar).getByText("PAtool")).toBeInTheDocument();
        expect(screen.getByText("Browse synoptic PurpleAir coverage")).toBeInTheDocument();
        expect(screen.getByText("Visible sensors")).toBeInTheDocument();
      },
      { timeout: 25000 }
    );
  });

  it("renders the map heatmap overlay lifecycle", async () => {
    window.history.pushState({}, "", "/map");
    const user = userEvent.setup();

    render(<App />);

    // The map page is lazy-loaded; its first transform can take a while.
    await waitFor(() => {
      expect(screen.getByText("Heatmap")).toBeInTheDocument();
    }, { timeout: 25000 });

    await user.click(screen.getByText("Heatmap"));

    await waitFor(() => {
      const map = mockMaps.at(-1);
      expect(map?.addSource).toHaveBeenCalledWith(
        expect.stringMatching(/^canvas-src-/),
        expect.objectContaining({ type: "canvas", animate: false }),
      );
      expect(map?.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.stringMatching(/^canvas-layer-/), type: "raster" }),
        undefined,
      );
      expect(map?.setPaintProperty).toHaveBeenCalledWith(expect.stringMatching(/^circle-layer-/), "circle-opacity", 0.35);
    }, { timeout: 10000 });

    await user.click(screen.getByText("Markers"));

    await waitFor(() => {
      const map = mockMaps.at(-1);
      expect(map?.removeLayer).toHaveBeenCalledWith(expect.stringMatching(/^canvas-layer-/));
      expect(map?.removeSource).toHaveBeenCalledWith(expect.stringMatching(/^canvas-src-/));
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
        expect(screen.getByText("PurpleAir workflow diagrams")).toBeInTheDocument();
        expect(screen.getByText("Final_Draft.pdf / Final_Draft.tex")).toBeInTheDocument();
      },
      { timeout: 25000 }
    );
  });

  it("renders the AirFuse static artifact viewer", async () => {
    window.history.pushState({}, "", "/airfuse");

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText("AirFuse surface viewer")).toBeInTheDocument();
        expect(screen.getByText("GeoJSON surface")).toBeInTheDocument();
        expect(screen.getByText("Validation CSV")).toBeInTheDocument();
      },
      { timeout: 25000 },
    );

    await waitFor(
      () => {
        const map = mockMaps.at(-1);
        expect(map?.addSource).toHaveBeenCalledWith(
          expect.stringMatching(/^fill-src-/),
          expect.objectContaining({ type: "geojson" }),
        );
        expect(map?.fitBounds).toHaveBeenCalled();
      },
      { timeout: 25000 },
    );
  });

  it("renders the AirNow reference comparison page", async () => {
    window.history.pushState({}, "", "/comparison");

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText("AirNow reference comparison")).toBeInTheDocument();
        expect(screen.getByText(/AirNow is official\/reference context/)).toBeInTheDocument();
        expect(screen.getByText(/PurpleAir AQI is sensor-derived\/corrected/)).toBeInTheDocument();
        expect(screen.getByText("AQS")).toBeInTheDocument();
        expect(screen.getByText("OpenAQ")).toBeInTheDocument();
        expect(screen.getByText("Reference validation")).toBeInTheDocument();
        expect(screen.getByText("Recent paired observations")).toBeInTheDocument();
      },
      { timeout: 25000 }
    );

    const referenceCall = vi.mocked(fetch).mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("/api/reference/compare"));
    const referenceUrl = new URL(referenceCall ?? "", "https://patool.local");

    expect(referenceUrl.pathname).toBe("/api/reference/compare");
    expect(referenceUrl.searchParams.get("sensorId")).toBe(samplePatSeries.meta.sensorId);
    expect(referenceUrl.searchParams.get("latitude")).toBe(String(samplePatSeries.meta.latitude));
    expect(referenceUrl.searchParams.get("longitude")).toBe(String(samplePatSeries.meta.longitude));
    expect(referenceUrl.searchParams.get("start")).toBe(samplePatSeries.points[0].timestamp);
    expect(referenceUrl.searchParams.get("end")).toBe(samplePatSeries.points.at(-1)?.timestamp);
    expect(referenceUrl.searchParams.get("source")).toBe("airnow");
  });

  it("renders the PurpleAir report builder", async () => {
    window.history.pushState({}, "", "/reports");

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText("PurpleAir summary report maker")).toBeInTheDocument();
        expect(screen.getByText("Report configuration")).toBeInTheDocument();
        expect(screen.getByText("Consistent add-ons")).toBeInTheDocument();
        expect(screen.getByText("Sensor set")).toBeInTheDocument();
        expect(screen.getByText("Figure readiness")).toBeInTheDocument();
        expect(screen.getByText("Hotspot and coldspot ranking")).toBeInTheDocument();
        expect(screen.getByText("Recommendation blocks")).toBeInTheDocument();
      },
      { timeout: 25000 }
    );
  });
});
