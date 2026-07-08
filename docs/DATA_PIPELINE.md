# PAtool data pipeline

PAtool ships as a static site: the published GitHub Pages build never calls a
live `/api`. Instead the browser reads committed JSON fixtures through the
static adapter in `app/src/lib/staticApi.ts`. This document describes where that
data comes from, how it is generated, and how to reproduce it.

## Stages at a glance

```
raw sources                     generators (scripts/)            committed fixtures            runtime assets
─────────────────────────────   ──────────────────────────────   ───────────────────────────   ────────────────────────
AirSensor R .rda data       ─▶  convert_rda_fixtures.py       ─▶  shared/src/generated/       ─▶  app/public/data/
PurpleAir daily CSV exports ─▶  build_network_timeseries.mjs  ─▶    example_pas.collection.json    (copied at build time by
biteSizedAQ exports         ─▶  import_bitesizedaq_data.mjs   ─▶    example_pat.series.json         prepare_static_data.mjs;
source code @equation docs  ─▶  extract_equations.mjs         ─▶    network_timeseries.json         only the 3 runtime assets
                                                                    equations.json  … etc.          are shipped)
```

`npm run build:pages` runs `equations:extract` → `prepare:static-data` →
`build --workspace app`, so a Pages build always regenerates equations and
re-copies the runtime assets before bundling.

## Scripts

| script | npm alias | purpose |
| ------ | --------- | ------- |
| `scripts/convert_rda_fixtures.py` | `fixtures:convert` | Convert the original AirSensor R `.rda` fixtures into the normalized `example_pas.*` / `example_pat.*` JSON. Requires a local AirSensor checkout. |
| `scripts/build_network_timeseries.mjs` | `network:build` | Build a `NetworkTimeSeries` fixture from a directory of PurpleAir daily/hourly CSV exports (see `data/prince-george-sample`). Applies the EPA AirNow F&SM (Equation 1) correction, buckets to day/hour, and pivots sensors onto a shared timestamp axis. |
| `scripts/import_bitesizedaq_data.mjs` | `fixtures:import-bitesizedaq` | Import biteSizedAQ exports into the `bitesizedaq_*` fixtures used by the Super Pollutants page. |
| `scripts/extract_equations.mjs` | `equations:extract` | Generate `equations.json` from `@equation` JSDoc blocks in the source, so the Equations reference page is derived from code, not hand-maintained. |
| `scripts/prepare_static_data.mjs` | `prepare:static-data` | Copy the runtime fixtures the static app actually fetches into `app/public/data/`. |

## Runtime assets

`prepare_static_data.mjs` ships only the three fixtures `staticApi.ts` fetches
at runtime, to keep the Pages payload small:

- `example_pas.collection.json` — synoptic PAS snapshot (Explorer, Map, table).
- `example_pat.series.json` — a template PAT time series; the static adapter
  derives deterministic per-sensor demo series from it.
- `network_timeseries.json` — the network time-lapse surface.

The remaining `shared/src/generated/*.json` files back `@patool/shared/fixtures`
(tests and Worker fallback) and are intentionally not shipped. If `staticApi.ts`
starts fetching a new file, add it to `RUNTIME_ASSETS` in
`prepare_static_data.mjs`.

## Sample source data

`data/prince-george-sample/` holds a committed slice of the PurpleAir daily CSV
exports (Prince George, BC; 36 sensors; 2022-11-17 → 2023-01-17). It documents
the expected CSV shape and makes `network:build` runnable from a clean checkout:

```bash
npm run network:build   # -> shared/src/generated/network_timeseries.sample.json
```

That produces 35 sites × 62 daily timestamps — a subset of the committed
`network_timeseries.json`, which was generated from a fuller (50-site, 365-day)
export of the same network. See `data/prince-george-sample/README.md` for the
column reference and provenance.
