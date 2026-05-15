export type CriteriaPollutant = "PM25" | "PM10" | "NO2" | "SO2" | "O3" | "CO";

export type AirQualityStandardRecord = {
  iso3: string;
  country: string;
  pollutant: CriteriaPollutant;
  duration: string;
  numericStandard: number | null;
};

export type CountryStandardsCoverage = {
  iso3: string;
  country: string;
  pollutantCount: number;
  coverageFraction: number;
  pollutantsWithStandards: CriteriaPollutant[];
  missingPollutants: CriteriaPollutant[];
  pm25AnnualStandard: number | null;
  pm25AnnualTier: "who-aligned" | "intermediate" | "lenient" | "missing";
};

const CRITERIA_POLLUTANTS: CriteriaPollutant[] = ["PM25", "PM10", "NO2", "SO2", "O3", "CO"];

export function summarizeStandardsCoverage(
  records: ReadonlyArray<AirQualityStandardRecord>,
): CountryStandardsCoverage[] {
  const groups = new Map<string, AirQualityStandardRecord[]>();
  for (const record of records) {
    const key = record.iso3.trim().toUpperCase();
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0];
    const pollutantsWithStandards = CRITERIA_POLLUTANTS.filter((pollutant) => (
      group.some((record) => record.pollutant === pollutant && validStandard(record.numericStandard))
    ));
    const missingPollutants = CRITERIA_POLLUTANTS.filter((pollutant) => !pollutantsWithStandards.includes(pollutant));
    const pm25AnnualStandard = group.find((record) => (
      record.pollutant === "PM25" &&
      annualDuration(record.duration) &&
      validStandard(record.numericStandard)
    ))?.numericStandard ?? null;

    return {
      iso3: first.iso3.toUpperCase(),
      country: first.country,
      pollutantCount: pollutantsWithStandards.length,
      coverageFraction: pollutantsWithStandards.length / CRITERIA_POLLUTANTS.length,
      pollutantsWithStandards,
      missingPollutants,
      pm25AnnualStandard,
      pm25AnnualTier: pm25AnnualTier(pm25AnnualStandard),
    };
  }).sort((a, b) => b.pollutantCount - a.pollutantCount || a.country.localeCompare(b.country));
}

export function countStandardsCoverageBuckets(
  summaries: ReadonlyArray<CountryStandardsCoverage>,
): Array<{ pollutantCount: number; countries: number; percent: number }> {
  const total = summaries.length || 1;
  return Array.from({ length: CRITERIA_POLLUTANTS.length + 1 }, (_, pollutantCount) => {
    const countries = summaries.filter((summary) => summary.pollutantCount === pollutantCount).length;
    return {
      pollutantCount,
      countries,
      percent: (countries / total) * 100,
    };
  });
}

function validStandard(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function annualDuration(duration: string): boolean {
  const normalized = duration.trim().toLowerCase();
  return normalized === "yr" || normalized === "year" || normalized === "annual";
}

function pm25AnnualTier(value: number | null): CountryStandardsCoverage["pm25AnnualTier"] {
  if (!validStandard(value)) return "missing";
  if (value <= 5) return "who-aligned";
  if (value <= 15) return "intermediate";
  return "lenient";
}
