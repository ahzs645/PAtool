import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const defaultSource = "/Users/ahmadjalil/Downloads/New Folder With Items/biteSizedAQ-main";
const sourceRoot = process.env.BITESIZEDAQ_DIR ? resolve(process.env.BITESIZEDAQ_DIR) : defaultSource;
const generatedDir = resolve(root, "shared", "src", "generated");

mkdirSync(generatedDir, { recursive: true });

function readCsv(relativePath) {
  const text = readFileSync(resolve(sourceRoot, relativePath), "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  return rows.slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function numberOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toUpperCase() === "NA" || trimmed.toLowerCase() === "nan") return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return null;
}

function writeJson(file, data) {
  writeFileSync(resolve(generatedDir, file), `${JSON.stringify(data, null, 2)}\n`);
}

function standardsCoverage() {
  const criteria = ["PM25", "PM10", "NO2", "SO2", "O3", "CO"];
  const rows = readCsv("18.bite.sized.vis.4.who.nat.aq.st.database.2025/raw.data.csv")
    .map((row) => ({
      iso3: row.iso3,
      country: row.country,
      pollutant: row.pollutant_name === "PM2.5" ? "PM25" : row.pollutant_name,
      duration: row.duration,
      numericStandard: numberOrNull(row.aqs_numeric),
    }))
    .filter((row) => criteria.includes(row.pollutant));

  const groups = new Map();
  for (const row of rows) {
    const key = row.iso3.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const pollutantsWithStandards = criteria.filter((pollutant) => (
      group.some((row) => row.pollutant === pollutant && typeof row.numericStandard === "number" && row.numericStandard > 0)
    ));
    const pm25AnnualStandard = group.find((row) => (
      row.pollutant === "PM25" &&
      ["yr", "year", "annual"].includes(row.duration.trim().toLowerCase()) &&
      typeof row.numericStandard === "number" &&
      row.numericStandard > 0
    ))?.numericStandard ?? null;
    const pm25AnnualTier = pm25AnnualStandard === null
      ? "missing"
      : pm25AnnualStandard <= 5
        ? "who-aligned"
        : pm25AnnualStandard <= 15
          ? "intermediate"
          : "lenient";

    return {
      iso3: first.iso3.toUpperCase(),
      country: first.country,
      pollutantCount: pollutantsWithStandards.length,
      coverageFraction: pollutantsWithStandards.length / criteria.length,
      pollutantsWithStandards,
      missingPollutants: criteria.filter((pollutant) => !pollutantsWithStandards.includes(pollutant)),
      pm25AnnualStandard,
      pm25AnnualTier,
    };
  }).sort((a, b) => b.pollutantCount - a.pollutantCount || a.country.localeCompare(b.country));
}

function monitorMetadataSummary() {
  const rows = readCsv("26.bite.sized.vis.6.aq.metadata.gap.filled/global_aq_mon_metadata/dataset/dataset_v_1.csv")
    .map((row) => ({
      iso: row.iso.toUpperCase(),
      longitude: numberOrNull(row.longitude),
      latitude: numberOrNull(row.latitude),
      elevation: numberOrNull(row.elevation),
      area: row.area || null,
      type: row.type || null,
      labeledArea: numberOrNull(row.labeled_area) === 1,
      labeledType: numberOrNull(row.labeled_type) === 1,
    }));

  const groups = new Map();
  for (const row of rows) groups.set(row.iso, [...(groups.get(row.iso) ?? []), row]);

  const share = (group, predicate) => group.length ? group.filter(predicate).length / group.length : 0;
  return [...groups.entries()].map(([iso, group]) => {
    const coordinateCoverage = share(group, (row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
    const elevationCoverage = share(group, (row) => Number.isFinite(row.elevation));
    const areaClassificationCoverage = share(group, (row) => Boolean(row.area));
    const typeClassificationCoverage = share(group, (row) => Boolean(row.type));
    const officialAreaCoverage = share(group, (row) => row.labeledArea);
    const officialTypeCoverage = share(group, (row) => row.labeledType);
    return {
      iso,
      monitorCount: group.length,
      coordinateCoverage,
      elevationCoverage,
      areaClassificationCoverage,
      typeClassificationCoverage,
      officialAreaCoverage,
      officialTypeCoverage,
      metadataCompleteness: (
        coordinateCoverage +
        elevationCoverage +
        areaClassificationCoverage +
        typeClassificationCoverage +
        officialAreaCoverage +
        officialTypeCoverage
      ) / 6,
    };
  }).sort((a, b) => b.monitorCount - a.monitorCount || a.iso.localeCompare(b.iso));
}

function dataReadinessScores() {
  const rows = readCsv("10.bite.sized.vis.3.openaq.gl.2024.report.summary/final.plot.data.csv");
  return rows.map((row) => {
    const checks = [
      ["public access", boolOrNull(row.pub_acc_data_in_country_only)],
      ["full transparency", boolOrNull(row.ful_trans)],
      ["physical units", boolOrNull(row.physical_data_av)],
      ["station coordinates", boolOrNull(row.st_lev_and_coord_av)],
      ["timely fine-scale data", boolOrNull(row.timely_fine_scale_av)],
      ["programmatic access", boolOrNull(row.prog_acess_av ?? row.prog_access_av)],
    ];
    const governmentMonitoring2024 = boolOrNull(row.cur_gov_aq_mon_2024) === true;
    const present = governmentMonitoring2024 ? checks.filter(([, value]) => value === true).map(([label]) => label) : [];
    const missing = governmentMonitoring2024 ? checks.filter(([, value]) => value !== true).map(([label]) => label) : ["government monitoring"];
    const score = governmentMonitoring2024 ? present.length / checks.length : 0;
    return {
      country: row.country,
      score,
      tier: !governmentMonitoring2024 ? "not-monitoring" : score >= 0.9 ? "excellent" : score >= 0.65 ? "usable" : score >= 0.35 ? "limited" : "not-open",
      missing,
      present,
      dataSharingStatus: row.data_sharing_status,
    };
  }).sort((a, b) => b.score - a.score || a.country.localeCompare(b.country));
}

function indiaPm25Trends() {
  const rows = readCsv("9.bite.sized.vis.2.ind.st.pol.time.series/ind_st_lev_pol_1998_2020_final.csv");
  return rows.map((row) => ({
    state: row.state_ut,
    year: numberOrNull(row.year),
    minPm25: numberOrNull(row.min_pm25),
    maxPm25: numberOrNull(row.max_pm25),
    avgPm25: numberOrNull(row.avg_pm25),
  })).filter((row) => row.year !== null && row.avgPm25 !== null);
}

function indiaBlockSnapshotSummary() {
  const rows = readCsv("7.bite.sized.vis.1.ind_bl_pol_dist/final_data.csv");
  const byState = new Map();
  for (const row of rows) {
    const state = row.state_name;
    const population = numberOrNull(row.subdistrict_population) ?? 0;
    const pm25 = numberOrNull(row["ann_avg_pop_weight_pm2.5_2022"]);
    if (!state || pm25 === null) continue;
    const summary = byState.get(state) ?? {
      state,
      subdistrictCount: 0,
      population: 0,
      weightedPm25Numerator: 0,
      aboveWhoPopulation: 0,
      aboveIndiaStandardPopulation: 0,
      minPm25: Number.POSITIVE_INFINITY,
      maxPm25: Number.NEGATIVE_INFINITY,
    };
    summary.subdistrictCount += 1;
    summary.population += population;
    summary.weightedPm25Numerator += pm25 * population;
    if (pm25 > 5) summary.aboveWhoPopulation += population;
    if (pm25 > 40) summary.aboveIndiaStandardPopulation += population;
    summary.minPm25 = Math.min(summary.minPm25, pm25);
    summary.maxPm25 = Math.max(summary.maxPm25, pm25);
    byState.set(state, summary);
  }

  return [...byState.values()].map((row) => ({
    state: row.state,
    subdistrictCount: row.subdistrictCount,
    population: row.population,
    populationWeightedPm25: row.population > 0 ? row.weightedPm25Numerator / row.population : null,
    aboveWhoPopulationFraction: row.population > 0 ? row.aboveWhoPopulation / row.population : null,
    aboveIndiaStandardPopulationFraction: row.population > 0 ? row.aboveIndiaStandardPopulation / row.population : null,
    minPm25: Number.isFinite(row.minPm25) ? row.minPm25 : null,
    maxPm25: Number.isFinite(row.maxPm25) ? row.maxPm25 : null,
  })).sort((a, b) => (b.populationWeightedPm25 ?? 0) - (a.populationWeightedPm25 ?? 0));
}

const outputs = {
  "bitesizedaq_standards_coverage.json": standardsCoverage(),
  "bitesizedaq_monitor_metadata_summary.json": monitorMetadataSummary(),
  "bitesizedaq_data_readiness_scores.json": dataReadinessScores(),
  "bitesizedaq_india_pm25_trends.json": indiaPm25Trends(),
  "bitesizedaq_india_block_snapshot_summary.json": indiaBlockSnapshotSummary(),
};

for (const [file, data] of Object.entries(outputs)) {
  writeJson(file, data);
  console.log(`Wrote ${file}: ${Array.isArray(data) ? data.length : 1} rows`);
}
