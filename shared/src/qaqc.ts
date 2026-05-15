export type QaQcPoint = {
  id?: string;
  timestamp: string;
  value: number | null;
};

export type QaQcFlagCode =
  | "missing"
  | "negative"
  | "duplicate-time"
  | "constant-run"
  | "z-score-outlier"
  | "hampel-outlier"
  | "sudden-spike"
  | "sudden-drop";

export type QaQcFlag = {
  code: QaQcFlagCode;
  index: number;
  timestamp: string;
  value: number | null;
  message: string;
};

export type AutoQaQcOptions = {
  constantRunLength?: number;
  zScoreThreshold?: number;
  hampelWindow?: number;
  hampelSigma?: number;
  spikeThreshold?: number;
  dropThreshold?: number;
};

function finiteValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: readonly number[]): number | null {
  const usable = values.filter(finiteValue).sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

function pushFlag(flags: QaQcFlag[], code: QaQcFlagCode, point: QaQcPoint, index: number, message: string) {
  flags.push({ code, index, timestamp: point.timestamp, value: point.value, message });
}

export function autoQaQcFlags(
  points: readonly QaQcPoint[],
  options: AutoQaQcOptions = {},
): QaQcFlag[] {
  const constantRunLength = options.constantRunLength ?? 4;
  const zScoreThreshold = options.zScoreThreshold ?? 4;
  const hampelWindow = options.hampelWindow ?? 3;
  const hampelSigma = options.hampelSigma ?? 3;
  const spikeThreshold = options.spikeThreshold ?? 35;
  const dropThreshold = options.dropThreshold ?? 35;
  const flags: QaQcFlag[] = [];
  const seen = new Set<string>();
  const finite = points.map((point) => point.value).filter(finiteValue);
  const globalMean = finite.length ? mean(finite) : 0;
  const globalSd = sd(finite);

  let runValue: number | null = null;
  let runStart = 0;
  let runLength = 0;

  points.forEach((point, index) => {
    if (!finiteValue(point.value)) {
      pushFlag(flags, "missing", point, index, "Value is missing or non-finite.");
    } else if (point.value < 0) {
      pushFlag(flags, "negative", point, index, "Value is below zero.");
    }

    const duplicateKey = `${point.id ?? ""}\u0000${point.timestamp}`;
    if (seen.has(duplicateKey)) {
      pushFlag(flags, "duplicate-time", point, index, "Duplicate timestamp for the same site.");
    }
    seen.add(duplicateKey);

    if (finiteValue(point.value) && globalSd > 0 && Math.abs((point.value - globalMean) / globalSd) > zScoreThreshold) {
      pushFlag(flags, "z-score-outlier", point, index, "Value exceeds the configured z-score threshold.");
    }

    if (finiteValue(point.value)) {
      if (runValue === point.value) {
        runLength += 1;
      } else {
        runValue = point.value;
        runStart = index;
        runLength = 1;
      }
      if (runLength === constantRunLength) {
        for (let runIndex = runStart; runIndex <= index; runIndex += 1) {
          pushFlag(flags, "constant-run", points[runIndex], runIndex, "Value is part of a constant run.");
        }
      } else if (runLength > constantRunLength) {
        pushFlag(flags, "constant-run", point, index, "Value is part of a constant run.");
      }
    }

    const previousValue = index > 0 ? points[index - 1]?.value : null;
    if (finiteValue(point.value) && finiteValue(previousValue)) {
      const delta = point.value - previousValue;
      if (delta > spikeThreshold) {
        pushFlag(flags, "sudden-spike", point, index, "Value increased faster than the configured threshold.");
      }
      if (-delta > dropThreshold) {
        pushFlag(flags, "sudden-drop", point, index, "Value decreased faster than the configured threshold.");
      }
    }

    if (finiteValue(point.value)) {
      const from = Math.max(0, index - hampelWindow);
      const to = Math.min(points.length, index + hampelWindow + 1);
      const windowValues = points.slice(from, to).map((row) => row.value).filter(finiteValue);
      const windowMedian = median(windowValues);
      if (windowMedian !== null) {
        const absoluteDeviations = windowValues.map((value) => Math.abs(value - windowMedian));
        const mad = median(absoluteDeviations) ?? 0;
        const threshold = hampelSigma * 1.4826 * mad;
        if (threshold > 0 && Math.abs(point.value - windowMedian) > threshold) {
          pushFlag(flags, "hampel-outlier", point, index, "Value exceeds the Hampel local median threshold.");
        }
      }
    }
  });

  return flags;
}
