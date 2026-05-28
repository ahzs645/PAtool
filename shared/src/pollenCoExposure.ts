/**
 * Pollen × PM2.5 co-exposure scoring inspired by biteSizedAQ notebook
 * #20. The literature is suggestive that pollen grains adsorb fine
 * particles, multiplying respiratory effects more than additive. This
 * module returns a small composite metric:
 *
 *   coExposureScore = pollenIndex × pm25 / 50
 *   warningLevel    = "low" | "moderate" | "high" | "extreme"
 */

export type PollenCategory = "tree" | "grass" | "weed" | "mold";

export type PollenObservation = {
  category: PollenCategory;
  /** Grains/m³ — same scale as common public dashboards. */
  index: number;
};

export type CoExposureWarning = "low" | "moderate" | "high" | "extreme";

export type CoExposureResult = {
  pm25: number;
  pollenTotal: number;
  coExposureScore: number;
  warningLevel: CoExposureWarning;
  drivers: string[];
};

const POLLEN_WEIGHTS: Record<PollenCategory, number> = {
  tree: 1,
  grass: 1.2,
  weed: 1.3,
  mold: 1.5,
};

export function coExposureScore(
  pm25: number,
  pollen: ReadonlyArray<PollenObservation>,
): CoExposureResult {
  const pm = Math.max(0, pm25);
  let weighted = 0;
  const drivers: string[] = [];
  for (const obs of pollen) {
    const w = POLLEN_WEIGHTS[obs.category];
    weighted += obs.index * w;
    if (obs.index > 1000) drivers.push(`${obs.category}=${obs.index} g/m³`);
  }
  const total = pollen.reduce((s, p) => s + p.index, 0);
  const score = (weighted * pm) / 50;
  const level: CoExposureWarning =
    score < 50 ? "low"
    : score < 200 ? "moderate"
    : score < 500 ? "high"
    : "extreme";
  if (pm > 35) drivers.unshift(`PM2.5=${pm.toFixed(1)} µg/m³`);
  return {
    pm25: pm,
    pollenTotal: total,
    coExposureScore: score,
    warningLevel: level,
    drivers,
  };
}
