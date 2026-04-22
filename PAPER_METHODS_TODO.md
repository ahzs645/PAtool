# Paper Methods TODO

This backlog captures paper-grade QC, interpolation, validation, data-layer, and workflow additions for PAtool based on the PDFs in `/Users/ahmadjalil/Downloads/New Folder With Items 3`.

## Source Papers

- Kar et al. 2024, Atmospheric Environment, "High spatio-temporal resolution predictions of PM2.5 using low-cost sensor data" (`1-s2.0-S1352231024001614-main.pdf`)
- Kar et al. 2024 supplementary information (`1-s2.0-S1352231024001614-mmc1.pdf`)
- Mohamed & Gong 2026, arXiv, "A comparison between geostatistical and machine learning models for spatio-temporal prediction of PM2.5 data" (`2509.12051v2.pdf`)
- Carroll et al. 2025, Scientific Reports, "Estimating PM2.5 concentrations at public schools in North Carolina using multiple data sources and interpolation methods" (`s41598-025-26539-3.pdf`)
- Lu et al. 2021, Environmental Research, "Estimating hourly PM2.5 concentrations at the neighborhood scale using a low-cost air sensor network: A Los Angeles case study" (`1-s2.0-S0013935120315504-main.pdf`)

## Current PAtool Baseline

- [x] Barkjohn 2021 PurpleAir PM2.5 correction exists in `shared/src/domain.ts`.
- [x] A/B channel agreement scoring exists in `shared/src/domain.ts`.
- [x] MAD/Hampel-style outlier rejection exists in `shared/src/domain.ts`.
- [x] Spatial IDW exists in `shared/src/domain.ts`.
- [x] Ordinary kriging with spherical variogram exists in `shared/src/domain.ts`.
- [x] Elevation-detrended LOOCV exists in `shared/src/interpolationCv.ts`.
- [x] Map grid generation and worker-backed interpolation are present in `app/src/pages/map/interpolation.ts` and `app/src/workers/interpolation.worker.ts`.

## A. QC And Calibration Hardening

- [ ] Add temperature sentinel-code filtering in ingestion normalization: drop `T == 2147483647`, `T == -224 F`, and `T > 1000 F`; clamp valid temperature to `[-58, 140] F`. Source: Mohamed & Gong 2026. Target: `shared/src/domain.ts`, `shared/src/purpleairLocal.ts`, `worker/src/purpleair.ts`.
- [ ] Add RH physical-range filtering: drop `RH <= 0`, `RH >= 100`, and the `255` artifact. Source: Mohamed & Gong 2026. Target: same ingestion normalization path.
- [ ] Add Carroll et al. A/B hard-drop rule: when channel average is `> 100 ug/m3`, drop if channel difference is `> 10%`; when average is `< 100 ug/m3`, drop if difference is `> 10 ug/m3`. Target: pair with existing `channelAgreementScore` logic in `shared/src/domain.ts`.
- [ ] Add monitor-level temperature-range heuristic for likely indoor sensors: flag or drop monitor if temperature range over the full time series is `< 10-20 F`. Source: Carroll et al. 2025. Target: QC pass over full PAT series.
- [ ] Add IQR outlier filter option using `median +/- 1.5 * IQR` alongside the existing MAD/Hampel option. Source: Carroll et al. 2025. Target: `shared/src/domain.ts` outlier helpers and `/api/outliers`.
- [ ] Add model-training-grade PM2.5 cap toggle to drop values `> 50 ug/m3`. Source: Kar et al. 2024. Target: QC config and model-training pipeline.
- [ ] Add missing-data threshold per sensor, dropping sensors with `> 10%` missing data for model training. Source: Carroll et al. 2025. Target: QC rollup.
- [ ] Add reduced-major-axis regression for PurpleAir unit-to-unit agreement. Source: Kar et al. SI. Target: new `rmaRegression()` helper in `shared/src/domain.ts`.
- [ ] Add random oversampling for high PM2.5 training observations as an optional model-training setting. Source: Lu et al. 2021. Target: future RF training pipeline.

## B. Interpolation And Modeling

- [ ] Add spatio-temporal IDW with weights `w = 1 / (d^2 + C * |dt|)` and a 1-D LOOCV grid search for `C`. Source: Carroll et al. 2025. Target: extend `app/src/pages/map/interpolation.ts`, `app/src/workers/interpolation.worker.ts`, and shared interpolation types.
- [ ] Add universal/regression kriging: fit a linear trend on covariates, then ordinary-krige residuals. Source: Kar et al. 2024; Mohamed & Gong 2026. Target: generalize existing ordinary kriging to accept a trend model.
- [ ] Add space-time regression kriging with sum-metric variogram `gamma(h,u) = gamma_s(h) + gamma_t(u) + gamma_st(sqrt(h^2 + (kappa * u)^2))`. Sources: Kar et al. 2024/SI; Carroll et al. 2025. Target: new `shared/src/spaceTimeKriging.ts` plus worker integration.
- [ ] Add random forest PM2.5 baseline with covariates. Sources: Kar et al. 2024; Lu et al. 2021; Mohamed & Gong 2026. Target: worker-backed model module, likely using a small browser-compatible RF implementation.
- [ ] Add Random Forest Spatial Interpolation (RFSI): features include covariates, nearest-neighbor observations, and nearest-neighbor distances. Source: Kar et al. 2024/SI. Target: grid worker model path with k-NN feature builder.
- [ ] Add Random Forest Kriging (RFK): RF trend plus space-time ordinary kriging of residuals. Source: Kar et al. 2024. Target: compose RF and STRK modules.
- [ ] Add Nearest-Neighbor Gaussian Process (NNGP) for scalable spatio-temporal kriging. Source: Mohamed & Gong 2026. Target: shared model module or Worker-only implementation.
- [ ] Add Fixed-Rank Kriging (FRK) with tensor-product bisquare basis. Source: Mohamed & Gong 2026. Target: shared model module for large sensor counts.
- [ ] Add hybrid ML + nearest-neighbor observations + kriging feature recipe, including the paper-winning SVR + NNO + NNGP-kriging feature variant. Source: Mohamed & Gong 2026. Target: model-training feature pipeline.
- [ ] Add Support Vector Regression with RBF kernel. Source: Mohamed & Gong 2026. Target: Worker model module.
- [ ] Add ensemble neural network model: two feed-forward networks plus ridge meta-learner. Source: Mohamed & Gong 2026. Target: optional advanced model module.
- [ ] Record INLA-SPDE as a non-browser path: Python/R only unless PAtool later grows a server-side modeling runner. Source: Mohamed & Gong 2026.
- [ ] Add hourly 500 m x 500 m random-forest gridded model option for Los Angeles-style workflows. Source: Lu et al. 2021. Target: RF model presets and grid configuration.

## C. Validation And Uncertainty

- [ ] Add true Leave-Location-Out CV grouped by sensor, not individual observation. Source: Kar et al. 2024. Target: `shared/src/interpolationCv.ts`.
- [ ] Add spatially blocked CV and report it beside random CV. Source: Mohamed & Gong 2026. Target: `shared/src/interpolationCv.ts` and diagnostics UI.
- [ ] Add Moran's I on residuals. Source: Mohamed & Gong 2026. Target: diagnostics module/page.
- [ ] Add empirical residual semivariogram diagnostic. Source: Mohamed & Gong 2026. Target: diagnostics module/page.
- [ ] Add SMAPE metric alongside RMSE, MAE, and bias. Source: Mohamed & Gong 2026. Target: `shared/src/interpolationCv.ts`.
- [ ] Add analytical 95% prediction intervals from kriging variance. Source: Mohamed & Gong 2026. Target: kriging outputs and map legend.
- [ ] Add empirical 95% prediction intervals from RF out-of-bag quantiles. Source: Mohamed & Gong 2026. Target: RF model output and map legend.
- [ ] Add 95% empirical coverage score: percent of EPA observations inside prediction intervals. Source: Mohamed & Gong 2026. Target: validation module and reliability plot.
- [ ] Add EPA AQS 3 x 3 grid-cell neighborhood comparison rather than point-only matching. Source: Kar et al. 2024. Target: new validation page or validation module.
- [ ] Add temporal CV split for time-held-out performance. Source: Lu et al. 2021. Target: validation module.

## D. External Data Layers

- [ ] Add NLCD 2019 land cover loader with Kar et al. SI 8-class aggregation: open water, open space, low-intensity development, medium-intensity development, high-intensity development, forest, grassland/agriculture, and wetlands. Source: MRLC NLCD; Kar et al. SI.
- [ ] Add TIGER/Line road processing for road length per grid cell. Source: Census TIGER; Kar et al. 2024.
- [ ] Add ACS 5-year population density by census block group. Source: ACS API; Kar et al. 2024.
- [ ] Add POI/visitor-count covariates from SafeGraph if licensed, or OSM/Overture Maps Places as a free substitute. Source: Kar et al. 2024.
- [ ] Add NOAA HRRR 3 km gridded temperature and relative humidity covariates. Source: NOAA HRRR NOMADS; Kar et al. 2024.
- [ ] Add USDA Rural-Urban Continuum Codes (RUCC) for locale tagging. Source: USDA ERS; Carroll et al. 2025.
- [ ] Add temporal covariates for hour, day of week, holiday, wildfire/non-typical day, and weekday/weekend patterns. Sources: Lu et al. 2021; Kar et al. 2024; Carroll et al. 2025.

## E. Workflow And UI

- [ ] Add 100 m x 100 m grid preset. Sources: Kar et al. 2024; Carroll et al. 2025. Target: map interpolation controls and grid configuration.
- [ ] Add 500 m x 500 m grid preset. Source: Lu et al. 2021. Target: map interpolation controls and grid configuration.
- [ ] Add hour-specific and month-specific model partitioning, including 8 AM and 6 PM presets. Source: Kar et al. 2024. Target: modeling workflow.
- [ ] Add day-type slicer: all, school-day, weekend, summer, testing-days. Source: Carroll et al. 2025. Target: modeling and exposure pages.
- [ ] Add school/POI exposure estimation page that interpolates to arbitrary lat/lon point lists. Source: Carroll et al. 2025. Target: new page/workflow.
- [ ] Add Bayesian spatiotemporal outcome-linkage page: PM2.5 as covariate in a linear model with spatial random effect and WAIC comparison. Source: Carroll et al. 2025. Target: advanced analysis page; likely server/Python/R backed.
- [ ] Add weekday/weekend/holiday/wildfire scenario maps for non-typical day analysis. Source: Lu et al. 2021. Target: map/modeling UI.
- [ ] Add time-activity diary export/join workflow for fine-scale exposure estimation. Source: Lu et al. 2021. Target: exposure workflow.

## Suggested Starter Pack

Implement in this order for the highest payoff per line of code:

- [ ] QC hardening: temperature/RH gates, A/B hard-drop rule, indoor T-range heuristic, IQR option, PM2.5 training cap, missing-data threshold, RMA regression.
- [ ] Spatio-temporal IDW with LOOCV tuning for `C`.
- [ ] Sum-metric space-time variogram and STRK.
- [ ] RFSI with k-NN observation and distance features.
- [ ] Validation toolkit: LLOCV, spatially blocked CV, Moran's I, SMAPE, residual semivariogram, 95% PI coverage.
- [ ] Covariate loaders: NLCD, HRRR, ACS, roads, POI/visitor layers.
- [ ] Optional high-accuracy model: hybrid NNO + kriging feature + ML, especially SVR + NNGP feature.
- [ ] Optional applied workflow: school/POI exposure page plus day-type slicer.

## Paper 3 Deep Dive: Carroll Et Al. 2025

This section expands the Carroll et al. 2025 Scientific Reports paper (`s41598-025-26539-3.pdf`) into implementation-ready PAtool tasks. This paper is the most directly pluggable into the current app because PAtool already has spatial IDW, ordinary kriging, A/B scoring, MAD outlier detection, and interpolation CV scaffolding.

### Exact PurpleAir QC Gates

Add these as hard-drop rules in the shared QC pipeline, with a named profile such as `carroll-2025-schools`.

- [ ] Drop sensors or observations with `location_type == "indoor"`.
- [ ] Drop observations when `channel_avg > 100` and `abs(A - B) / channel_avg > 0.10`.
- [ ] Drop observations when `channel_avg <= 100` and `abs(A - B) > 10 ug/m3`.
- [ ] Drop observations when `RH <= 0` or `RH >= 100`.
- [ ] Drop observations when `T_F <= -200` or `T_F >= 1000`.
- [ ] Drop sensors when temperature is entirely missing.
- [ ] Drop sensors when `missing_fraction > 0.10`.
- [ ] Drop or flag monitors when `max(T_F) - min(T_F) < 10 F`, because this suggests an indoor monitor.
- [ ] Drop observations outside `median +/- 1.5 * IQR`.

Primary target: `shared/src/domain.ts`. Related targets: worker ingestion and any frontend diagnostic labels that currently treat these as soft warnings.

### Spatio-Temporal IDW

Implement the paper's spatio-temporal IDW as a second IDW mode, not a replacement for existing spatial IDW.

```text
w_ij = 1 / (d_i^2 + C * abs(t_j - t_0))
w_tilde_ij = w_ij / sum(w)
x_hat_kl = sum_i sum_j w_tilde_ij * x_ij
```

- [ ] Use squared spatial distance and linear absolute time difference exactly as written above.
- [ ] Include monitor `i` only when it is within `500 km` of the target point.
- [ ] Include observation `j` only when it is within `+/- 90 days` of the target date.
- [ ] Add a LOOCV grid search for scalar `C`; Carroll et al. report `C = 10` as optimal for North Carolina.
- [ ] Surface `C`, distance window, and time window as model options with Carroll defaults.
- [ ] Add tests that verify the asymmetry between `d_i^2` and `abs(dt)`.

Targets: `shared/src/domain.ts` or a new shared interpolation module, `shared/src/interpolationCv.ts`, `app/src/pages/map/interpolation.ts`, and `app/src/workers/interpolation.worker.ts`.

### Sum-Metric Space-Time Kriging

Add a space-time kriging model based on the paper's sum-metric covariance/variogram construction.

```text
C(h, u) = C_s(h) + C_t(u) + C_joint(sqrt(h^2 + (kappa * u)^2))
gamma(h, u) = gamma_s(h) + gamma_t(u) + gamma_joint(sqrt(h^2 + (kappa * u)^2))
```

- [ ] Fit or configure three independent nugget/sill/range triples: spatial, temporal, and joint.
- [ ] Add anisotropy ratio `kappa`.
- [ ] Reuse the same `500 km` and `+/- 90 day` neighborhood as spatio-temporal IDW.
- [ ] Reuse as much of the current spherical variogram and ordinary kriging solver as possible.
- [ ] Add a dedicated test fixture with known spatial-only, temporal-only, and joint contributions.

Target: new `shared/src/spaceTimeKriging.ts`, then worker integration.

### Day-Type Aggregation

Add a `DayType` enum and rollup helpers so estimates can be generated by the paper's exposure windows.

- [ ] `all`: every day.
- [ ] `school-day`: Monday-Friday, excluding June, July, and August.
- [ ] `weekend`: Saturday and Sunday.
- [ ] `summer`: all days in June, July, and August.
- [ ] `testing`: last 10 school days of May.
- [ ] Produce day-type-specific validation rows and point estimates.

Targets: `shared/src/domain.ts`, Modeling page controls, Comparison page controls, and future point-estimate workflow.

### RUCC Locale Tagging

Carroll et al. use USDA Rural-Urban Continuum Codes to classify schools as rural, town, suburban, or urban. Their result that suburban schools have the highest PM2.5 is worth making explorable.

- [ ] Add a script to ingest USDA ERS RUCC county-level CSV data into `shared/src/generated/`.
- [ ] Add county/RUCC metadata to point estimate inputs or outputs.
- [ ] Map RUCC values into simplified labels: rural, town, suburban, urban.
- [ ] Add locale grouping to the future school/POI results table and plots.

### Point-Estimate Workflow

The paper estimates PM2.5 at roughly 2,500 North Carolina public school points, not only over a raster grid. PAtool should support this as a first-class workflow.

- [ ] Add `estimateAtPoints(coords, method, dayType, options)` in shared code.
- [ ] Return `value`, `method`, `dayType`, optional `interval`, and diagnostic metadata for each point.
- [ ] Support CSV upload or pasted `lat,lon` lists.
- [ ] Add a Schools/POIs page under `app/src/pages/`.
- [ ] Reuse ST-IDW first, then add sum-metric ST-kriging when available.

### Bayesian Outcome Linkage

This is optional and more ambitious than the interpolation work.

```text
reading_score_ij ~ beta_0
                 + beta_pm25 * PM2.5_school
                 + beta_student * student_covariates
                 + beta_school * school_covariates
                 + county_random_effect(spatial, CAR prior)
                 + year_random_effect(temporal)
                 + school_random_effect
```

- [ ] Treat WAIC differences of roughly `4-5` or larger as meaningful model-comparison signals.
- [ ] Start with an export workflow for R/INLA or CARBayesST rather than implementing CAR modeling in TypeScript.
- [ ] Optionally add a simplified Gaussian spatial random-effect model later if PAtool gains a server-side stats runner.
- [ ] Prioritize school-day PM2.5 averages because the paper reports the strongest reading-score association there.

### Cross-Validation Table Template

Reproduce the paper's Table 1-style reporting in PAtool.

- [ ] Report MSE, RMSE, MAE, and Pearson correlation.
- [ ] Break out by combined EPA + PurpleAir model, EPA-only model, and combined model evaluated at EPA sites.
- [ ] Break out by IDW vs kriging.
- [ ] Break out by day type.
- [ ] Add rows for ST-IDW and sum-metric ST-kriging once implemented.

### Paper 3 Build Order

- [ ] Implement Carroll 2025 QC hardening profile in `shared/src/domain.ts` with tests.
- [ ] Implement spatio-temporal IDW with `500 km`, `+/- 90 day`, and LOOCV `C` tuning.
- [ ] Add day-type slicer and shared rollup helpers.
- [ ] Add point-estimate workflow for uploaded or pasted school/POI coordinates.
- [ ] Add RUCC locale tagging from USDA ERS CSV.
- [ ] Add sum-metric space-time kriging.
- [ ] Add optional Bayesian outcome-linkage/export page.
