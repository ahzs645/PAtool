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

```bash
npm run fixtures:convert
```

## Current status

- App, shared package, and worker all build and test successfully.
- GET routes use edge caching headers and cache API lookups when available.
- The Worker falls back to fixture data when archive or PurpleAir credentials are unavailable.
