# Prince George PurpleAir sample dataset

A small, committed sample of raw PurpleAir daily export CSVs used to exercise
and reproduce PAtool's `NetworkTimeSeries` fixture. Keeping a copy in the repo
makes the data pipeline reproducible without depending on an external Drive
share that may move or require authentication.

## Provenance

- **Network:** PurpleAir community sensors around Prince George, British
  Columbia, Canada (≈53.8–54.0° N, −122.9 to −122.6° W).
- **Sensors:** 36 sensor units (35 with usable coordinates after cleaning).
- **Cadence:** hourly rows, one CSV per UTC day.
- **Span:** 2022-11-17 → 2023-01-17 (62 daily files).
- **Source:** shared Google Drive folder of daily exports; this directory is a
  representative slice, not the full multi-year archive.

## File format

One CSV per day, one row per sensor per hour:

| column         | meaning                                   |
| -------------- | ----------------------------------------- |
| `time_stamp`   | UTC timestamp (`YYYY-MM-DD HH:MM:SS+00:00`) |
| `humidity`     | relative humidity (%)                     |
| `temperature`  | temperature (°F)                          |
| `pressure`     | barometric pressure (hPa)                 |
| `pm1.0_cf_1`   | PM1.0 CF=1 (µg/m³)                         |
| `pm2.5_cf_1`   | PM2.5 CF=1 (µg/m³)                         |
| `pm10.0_cf_1`  | PM10 CF=1 (µg/m³)                          |
| `sensor_number`| PurpleAir sensor id                       |
| `latitude`     | sensor latitude                           |
| `longitude`    | sensor longitude                          |

Note: these exports carry a single combined `pm2.5_cf_1` per sensor-hour
(not separate A/B channels).

## Regenerating a NetworkTimeSeries from this sample

```bash
npm run network:build
# equivalent to:
node scripts/build_network_timeseries.mjs data/prince-george-sample \
  shared/src/generated/network_timeseries.sample.json day
```

The script applies the EPA AirNow Fire & Smoke Map (Equation 1) correction,
buckets rows to the requested interval (`day` or `hour`), and pivots sensors
onto a shared timestamp axis. Running it over this sample yields 35 sites ×
62 daily timestamps — a subset of the committed
`shared/src/generated/network_timeseries.json`, which was built from a fuller
(50-site, 365-day) export of the same network.
