# PAtool

`PAtool` is a static-first PurpleAir analysis utility built from the AirSensor example datasets. It ships as a Vite + React + TypeScript app and is designed to deploy directly to GitHub Pages without requiring a live backend.

## Repo layout

- `app`: React frontend published to GitHub Pages
- `shared`: TypeScript domain models, QC helpers, SoH calculations, interpolation, and diagnostics logic
- `worker`: optional Cloudflare Worker API for local API-style development
- `scripts`: fixture conversion and static-data preparation

## Static deployment model

The published Pages build does not call `/api` at runtime. Instead it:

1. Copies the committed generated fixture JSON into `app/public/data/`.
2. Uses a browser-side static adapter to emulate the app's API calls from local assets and shared TypeScript logic.

That means GitHub Pages can host the full demo as a static site.

## Local development

From the repo root:

```bash
npm install
npm run prepare:static-data
npm run dev
```

The default development app still proxies `/api/*` to the local Worker on `http://127.0.0.1:8787`.

## Optional live and LAN data

The Worker can use the PurpleAir API when a read key is configured:

```bash
export PURPLEAIR_API_KEY="your-purpleair-read-key"
npm run dev:worker
```

For local-network sensors, configure one or more LAN JSON URLs. This follows the pattern used by community tools such as `purpleair2mqtt`, `purpleair-prometheus`, Home Assistant local configs, and PurpleAir LAN apps that read directly from a sensor's `http://<sensor-ip>/json?live=true` endpoint.

```bash
export PURPLEAIR_LOCAL_SENSOR_URLS="garage=192.168.1.24,deck=http://192.168.1.25/json"
npm run dev
```

Configured LAN sensors are exposed through `/api/local-sensors`, merged into `/api/pas`, and available through `/api/pat?id=<configured-name>` as latest-point series. Live PurpleAir history requests now forward `start`, `end`, and `aggregate=hourly` to the upstream history endpoint instead of only filtering locally.

The app reads `/api/status` and shows a provenance banner when it is serving static fixtures or fallback data. In static mode, PAT series are deterministic per-sensor demo series scaled from each sensor's PAS snapshot instead of one identical template attached to every sensor.

## GitHub Pages build

```bash
npm run build:pages
```

The output is written to `app/dist/`.

## Notes

- The original AirSensor R package remains in the parent repository where this web workspace was first developed.
- The committed `shared/src/generated/*.json` files are what make the public Pages deployment self-contained.
- `worker/` is still useful for local API prototyping, but it is not required for the Pages deployment.

## PurpleAir ecosystem ideas incorporated

- Local sensor `/json` ingestion inspired by [purpleair2mqtt](https://github.com/pridkett/purpleair2mqtt), [purpleair-prometheus](https://github.com/deaddawg/purpleair-prometheus), [homeassistant-local-purpleair](https://github.com/tommack/homeassistant-local-purpleair), and [PurpleAir LAN](https://github.com/shrisha/purpleair-lan).
- History request shaping and transient retry behavior inspired by the [PurpleAir R package](https://github.com/cole-brokamp/PurpleAir).
- A US EPA-style PurpleAir PM2.5 correction helper inspired by AQI-focused widgets such as [PurpleAir-AQI-Scriptable-Widget](https://github.com/jasonsnell/PurpleAir-AQI-Scriptable-Widget).
