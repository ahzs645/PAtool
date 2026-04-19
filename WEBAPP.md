# AirSensor Web App

## Packages

- `app`: Vite 8 + React frontend
- `shared`: shared TypeScript domain models, normalization, QC, and SoH logic
- `worker`: Cloudflare Worker API for PAS/PAT/sensor/QC/SoH routes

## Local development

Run all web commands from `/Users/ahmadjalil/Downloads/AirSensor-master/web-app`.

1. Install dependencies:

```bash
npm install
```

2. Start the Worker:

```bash
npm run dev:worker
```

3. Start the app:

```bash
npm run dev:app
```

The Vite app proxies `/api/*` to `http://127.0.0.1:8787` in development. If you need a different origin, set `VITE_API_BASE_URL` in `app/.env.local`.

## Environment

Copy `worker/.dev.vars.example` to `worker/.dev.vars` and fill in real values when you want live/archive fetches instead of fixture fallback.

## Fixture conversion

The converter script reads the original R fixtures from `/Users/ahmadjalil/Downloads/AirSensor-master/data` and writes normalized JSON into `shared/src/generated`.

For the standalone public `PAtool` repo, GitHub Pages uses the committed generated JSON already in `shared/src/generated`. Re-conversion is only needed when refreshing data from the original AirSensor source checkout.

```bash
npm run fixtures:convert
```

## Current status

- App, shared package, and worker all build and test successfully.
- GET routes use edge caching headers and cache API lookups when available.
- The Worker falls back to fixture data when archive or PurpleAir credentials are unavailable.

## AirFuse viewer

The AirFuse page ports the static artifact viewer from `/Users/ahmadjalil/Downloads/airfuse-main/examples/typical/map.html` and keeps the Python AirFuse runtime out of the deployed app. PAtool loads the AirFuse/GOES GeoJSON, CSV, and NetCDF artifacts through a small Worker proxy at `/api/airfuse/proxy?path=...` because the upstream S3 bucket does not send browser CORS headers.

- Local source checkout: `/Users/ahmadjalil/Downloads/airfuse-main`
- Upstream source: `https://github.com/barronh/airfuse`
- Static artifact bucket: `https://airnow-navigator-layers.s3.us-east-2.amazonaws.com`
- Optional Worker override: set `AIRFUSE_BASE_URL` if the artifact bucket changes.
- Optional frontend override: set `VITE_AIRFUSE_API_BASE` to a deployed Worker origin when the static app is hosted separately from the Worker.

This preserves the serverless deployment model: AirFuse computation still happens outside PAtool, PAtool only renders already-published static artifacts, and the Worker only proxies/cache-wraps those artifacts for browser access. WASM is not required for this viewer; it would only be needed later if PAtool needs in-browser NetCDF inspection or local model computation.

## Reference diagrams

Data-flow and architecture diagrams from the original UMN Quality Air Quality Cities project (CC-licensed — see source repository). They describe the same PurpleAir QAQC → summarize → interpolate pipeline that PAtool implements client-side.

- High-level architecture: `app/public/docs/highlevelArchitecture.jpg`
- Historic + real-time summaries DFD: `app/public/docs/DFDHistoric_RealTime_Summaries.jpg`
- QAQC DFD: `app/public/docs/qaqcDFD.jpg`
- QAQC diagram: `app/public/docs/QAQCdiagram.jpg`
- Interpolation DFD: `app/public/docs/interpolationDFD.jpg`
- Modeling overview: `app/public/docs/Modeling.jpg`

When the app is served, each is also reachable at `/<basePath>/docs/<file>.jpg`.
