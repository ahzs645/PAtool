# PAtool

`PAtool` is a static-first PurpleAir analysis utility built from the AirSensor example datasets. It ships as a Vite + React + TypeScript app and is designed to deploy directly to GitHub Pages without requiring a live backend.

## Repo layout

- `app`: React frontend published to GitHub Pages
- `shared`: TypeScript domain models, QC helpers, SoH calculations, interpolation, and diagnostics logic
- `worker`: optional Cloudflare Worker API for local API-style development
- `scripts`: fixture conversion and static-data preparation

## Static deployment model

The published Pages build does not call `/api` at runtime. Instead it:

1. Converts the original R fixtures from `../data/*.rda` into JSON.
2. Copies those JSON files into `app/public/data/`.
3. Uses a browser-side static adapter to emulate the app's API calls from local assets and shared TypeScript logic.

That means GitHub Pages can host the full demo as a static site.

## Local development

From the `web-app/` directory:

```bash
npm install
npm run fixtures:convert
npm run prepare:static-data
npm run dev
```

The default development app still proxies `/api/*` to the local Worker on `http://127.0.0.1:8787`.

## GitHub Pages build

```bash
npm run fixtures:convert
npm run build:pages
```

The output is written to `app/dist/`.

## Notes

- The original AirSensor R package remains in the parent repository.
- `worker/` is still useful for local API prototyping, but it is not required for the Pages deployment.
