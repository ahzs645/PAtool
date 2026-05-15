import {
  EPA_PM25_AQI_PROFILE,
  pm25ToAqiBand,
  type AqiCategory,
  type AqiProfile,
} from "./domain";

export type AqiCompositionRow = {
  category: AqiCategory | "Unavailable";
  label: string;
  color: string;
  count: number;
  percent: number;
};

export type AqiPairedValue = {
  reference: number | null;
  sensor: number | null;
};

export type AqiCategoryStatistic = {
  category: AqiCategory;
  label: string;
  upperLimit: number;
  count: number;
  mbe: number | null;
  nmbe: number | null;
  rmse: number | null;
  nrmse: number | null;
};

export type AqiConfusionCell = {
  referenceCategory: AqiCategory;
  sensorCategory: AqiCategory;
  count: number;
  percentOfReference: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function categoryLabel(category: AqiCategory | undefined): AqiCategory | "Unavailable" {
  return category ?? "Unavailable";
}

export function aqiComposition(
  values: ReadonlyArray<number | null | undefined>,
  profile: AqiProfile = EPA_PM25_AQI_PROFILE,
): AqiCompositionRow[] {
  const counts = new Map<string, AqiCompositionRow>();
  for (const breakpoint of profile.breakpoints) {
    const category = breakpoint.category;
    if (!category) continue;
    counts.set(category, {
      category,
      label: categoryLabel(category),
      color: breakpoint.color,
      count: 0,
      percent: 0,
    });
  }
  counts.set("Unavailable", {
    category: "Unavailable",
    label: "Unavailable",
    color: "#6b7280",
    count: 0,
    percent: 0,
  });

  for (const value of values) {
    const band = pm25ToAqiBand(value, profile);
    const key = band.category ?? (band.label === "Unavailable" ? "Unavailable" : band.label);
    const row = counts.get(key);
    if (row) row.count += 1;
  }

  const total = values.length || 1;
  return [...counts.values()].map((row) => ({
    ...row,
    percent: (row.count / total) * 100,
  }));
}

export function aqiCategoryStatistics(
  pairs: readonly AqiPairedValue[],
  profile: AqiProfile = EPA_PM25_AQI_PROFILE,
): AqiCategoryStatistic[] {
  return profile.breakpoints.filter((breakpoint) => breakpoint.category).map((breakpoint) => {
    const category = breakpoint.category!;
    const categoryPairs = pairs.filter((pair) => (
      finiteNumber(pair.reference)
      && finiteNumber(pair.sensor)
      && (pm25ToAqiBand(pair.reference, profile).category ?? pm25ToAqiBand(pair.reference, profile).label) === category
    ));
    if (categoryPairs.length === 0) {
      return {
        category,
        label: categoryLabel(category),
        upperLimit: breakpoint.concentrationHigh ?? breakpoint.concHigh ?? Number.POSITIVE_INFINITY,
        count: 0,
        mbe: null,
        nmbe: null,
        rmse: null,
        nrmse: null,
      };
    }

    const errors = categoryPairs.map((pair) => pair.sensor! - pair.reference!);
    const referenceMean = categoryPairs.reduce((sum, pair) => sum + pair.reference!, 0) / categoryPairs.length;
    const mbe = errors.reduce((sum, error) => sum + error, 0) / errors.length;
    const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
    return {
      category,
      label: categoryLabel(category),
      upperLimit: breakpoint.concentrationHigh ?? breakpoint.concHigh ?? Number.POSITIVE_INFINITY,
      count: categoryPairs.length,
      mbe: round(mbe),
      nmbe: referenceMean !== 0 ? round((mbe / referenceMean) * 100) : null,
      rmse: round(rmse),
      nrmse: referenceMean !== 0 ? round((rmse / referenceMean) * 100) : null,
    };
  });
}

export function aqiConfusionMatrix(
  pairs: readonly AqiPairedValue[],
  profile: AqiProfile = EPA_PM25_AQI_PROFILE,
): AqiConfusionCell[] {
  const categories = profile.breakpoints.map((breakpoint) => breakpoint.category);
  const usable = pairs
    .map((pair) => ({
      reference: finiteNumber(pair.reference) ? pm25ToAqiBand(pair.reference, profile).category ?? null : null,
      sensor: finiteNumber(pair.sensor) ? pm25ToAqiBand(pair.sensor, profile).category ?? null : null,
    }))
    .filter((pair): pair is { reference: AqiCategory; sensor: AqiCategory } => pair.reference !== null && pair.sensor !== null);

  return categories.flatMap((referenceCategory) => {
    const referenceCount = usable.filter((pair) => pair.reference === referenceCategory).length;
    return categories.map((sensorCategory) => {
      const count = usable.filter((pair) => pair.reference === referenceCategory && pair.sensor === sensorCategory).length;
      return {
        referenceCategory,
        sensorCategory,
        count,
        percentOfReference: referenceCount > 0 ? (count / referenceCount) * 100 : 0,
      };
    });
  });
}
