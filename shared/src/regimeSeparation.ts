import type { SmokePolygon } from "./hazards";

export type Pm25Regime =
  | "background"
  | "local"
  | "winter-inversion"
  | "wildfire"
  | "mixed"
  | "sensor-fault"
  | "unknown";

export type RegimeConfidence = "high" | "medium" | "low";

export type SmokeDensity = SmokePolygon["density"] | "none";

export type RegimeClassificationInput = {
  timestamp?: string;
  pm25?: number | null;
  temperatureF?: number | null;
  relativeHumidity?: number | null;
  channelAgreementValid?: boolean | null;
  smokeDensity?: SmokeDensity;
  nearbyFire?: boolean;
  nearestFireKm?: number | null;
  windAlignedWithFire?: boolean;
  windFromLocalSource?: boolean;
  localSourceSignal?: boolean;
  lowWindOrInversionSignal?: boolean;
  referencePm25?: number | null;
};

export type RegimeClassification = {
  regime: Pm25Regime;
  confidence: RegimeConfidence;
  scores: {
    wildfire: number;
    winter: number;
    local: number;
    fault: number;
  };
  reasons: string[];
};

export type RegimeSummaryRow = {
  regime: Pm25Regime;
  count: number;
  fraction: number;
  meanPm25: number | null;
};

export type RegimeSeparatedExposure = {
  totalPm25: number | null;
  localPm25: number | null;
  wildfireIncrementPm25: number | null;
  backgroundPm25: number | null;
  uncertaintyPm25: number | null;
  regime: Pm25Regime;
  confidence: RegimeConfidence;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function monthFromTimestamp(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const time = new Date(timestamp);
  if (!Number.isFinite(time.getTime())) return null;
  return time.getUTCMonth() + 1;
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function confidenceFromScores(primary: number, secondary: number): RegimeConfidence {
  if (primary >= 3 && primary - secondary >= 1) return "high";
  if (primary >= 1.5) return "medium";
  return "low";
}

export function classifyPm25Regime(input: RegimeClassificationInput): RegimeClassification {
  const pm25 = finiteNumber(input.pm25) ? input.pm25 : null;
  const month = monthFromTimestamp(input.timestamp);
  const isWinter = month === 11 || month === 12 || month === 1 || month === 2;
  const reasons: string[] = [];

  let fault = 0;
  if (input.channelAgreementValid === false) {
    fault += 4;
    reasons.push("PurpleAir A/B channel agreement failed.");
  }

  if (fault >= 4) {
    return {
      regime: "sensor-fault",
      confidence: "high",
      scores: { wildfire: 0, winter: 0, local: 0, fault },
      reasons,
    };
  }

  let wildfire = 0;
  const density = input.smokeDensity ?? "none";
  if (density === "heavy") {
    wildfire += 3;
    reasons.push("Heavy HMS smoke context is present.");
  } else if (density === "medium") {
    wildfire += 2;
    reasons.push("Medium HMS smoke context is present.");
  } else if (density === "light") {
    wildfire += 1;
    reasons.push("Light HMS smoke context is present.");
  }
  if (input.nearbyFire) {
    wildfire += 1.25;
    reasons.push("Nearby active fire detections are present.");
  }
  if (finiteNumber(input.nearestFireKm)) {
    if (input.nearestFireKm <= 50) wildfire += 1.5;
    else if (input.nearestFireKm <= 150) wildfire += 0.75;
  }
  if (input.windAlignedWithFire) {
    wildfire += 0.75;
    reasons.push("Wind is aligned with likely smoke transport.");
  }
  if (pm25 !== null && pm25 >= 35) wildfire += 0.75;

  let winter = 0;
  if (isWinter) winter += 0.75;
  if (input.lowWindOrInversionSignal) {
    winter += 1.25;
    reasons.push("Low-wind or inversion context is present.");
  }
  if (finiteNumber(input.temperatureF) && input.temperatureF <= 32) winter += 0.75;
  if (finiteNumber(input.relativeHumidity) && input.relativeHumidity >= 80) winter += 0.5;
  if (pm25 !== null && pm25 >= 12 && isWinter) winter += 0.5;

  let local = 0;
  if (input.localSourceSignal) {
    local += 1.5;
    reasons.push("Local-source context is present.");
  }
  if (input.windFromLocalSource) {
    local += 1;
    reasons.push("Wind is consistent with a local source sector.");
  }
  if (pm25 !== null && pm25 >= 12 && wildfire < 1) local += 0.5;
  if (pm25 !== null && finiteNumber(input.referencePm25) && pm25 - input.referencePm25 >= 5) {
    local += 1;
    reasons.push("Sensor PM2.5 is elevated relative to the reference monitor.");
  }

  let regime: Pm25Regime = "unknown";
  const sorted = [
    ["wildfire", wildfire],
    ["winter-inversion", winter],
    ["local", local],
  ] as const;
  const [primaryName, primaryScore] = [...sorted].sort((a, b) => b[1] - a[1])[0];
  const secondaryScore = [...sorted].sort((a, b) => b[1] - a[1])[1][1];

  if (wildfire >= 2 && (winter >= 1.5 || local >= 1.5)) {
    regime = "mixed";
    reasons.push("Wildfire context overlaps with local or winter-stagnation signals.");
  } else if (primaryScore >= 1.25) {
    regime = primaryName;
  } else if (pm25 !== null && pm25 < 8 && wildfire === 0 && winter < 1 && local < 1) {
    regime = "background";
    reasons.push("PM2.5 is low and no event context is present.");
  }

  if (reasons.length === 0) reasons.push("No single regime signal dominates.");

  return {
    regime,
    confidence: confidenceFromScores(primaryScore, secondaryScore),
    scores: {
      wildfire: round(wildfire),
      winter: round(winter),
      local: round(local),
      fault,
    },
    reasons,
  };
}

export function summarizeRegimeClassifications(
  rows: Array<{ classification: RegimeClassification; pm25?: number | null }>,
): RegimeSummaryRow[] {
  const regimes: Pm25Regime[] = ["background", "local", "winter-inversion", "wildfire", "mixed", "sensor-fault", "unknown"];
  const total = rows.length;
  return regimes.map((regime) => {
    const matched = rows.filter((row) => row.classification.regime === regime);
    const values = matched.map((row) => row.pm25).filter(finiteNumber);
    const meanPm25 = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      regime,
      count: matched.length,
      fraction: total > 0 ? matched.length / total : 0,
      meanPm25: meanPm25 === null ? null : round(meanPm25),
    };
  }).filter((row) => row.count > 0);
}

export function estimateRegimeSeparatedExposure(input: {
  totalPm25?: number | null;
  backgroundPm25?: number | null;
  referencePm25?: number | null;
  classification: RegimeClassification;
}): RegimeSeparatedExposure {
  const total = finiteNumber(input.totalPm25) ? Math.max(0, input.totalPm25) : null;
  if (total === null) {
    return {
      totalPm25: null,
      localPm25: null,
      wildfireIncrementPm25: null,
      backgroundPm25: null,
      uncertaintyPm25: null,
      regime: input.classification.regime,
      confidence: input.classification.confidence,
    };
  }

  const background = finiteNumber(input.backgroundPm25)
    ? Math.max(0, input.backgroundPm25)
    : finiteNumber(input.referencePm25)
      ? Math.max(0, input.referencePm25)
      : Math.min(total, 5);
  const eventIncrement = Math.max(0, total - background);
  const isWildfire = input.classification.regime === "wildfire" || input.classification.regime === "mixed";
  const wildfireIncrement = isWildfire ? eventIncrement : 0;
  const localPm25 = Math.max(0, total - wildfireIncrement);
  const uncertaintyFactor = input.classification.confidence === "high" ? 0.15 : input.classification.confidence === "medium" ? 0.25 : 0.4;

  return {
    totalPm25: round(total),
    localPm25: round(localPm25),
    wildfireIncrementPm25: round(wildfireIncrement),
    backgroundPm25: round(background),
    uncertaintyPm25: round(Math.max(1, total * uncertaintyFactor)),
    regime: input.classification.regime,
    confidence: input.classification.confidence,
  };
}
