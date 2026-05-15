export type BaselineResult = {
  baseline: number[];
  corrected: Array<number | null>;
};

export type BaselineOptions = {
  windowSize?: number;
  quantile?: number;
};

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const position = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function fillMissing(values: Array<number | null>): number[] {
  const filled = values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
  let previous = filled.find((value): value is number => value !== null) ?? 0;
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] === null) filled[i] = previous;
    else previous = filled[i]!;
  }
  let next = previous;
  for (let i = filled.length - 1; i >= 0; i -= 1) {
    if (filled[i] === null) filled[i] = next;
    else next = filled[i]!;
  }
  return filled as number[];
}

export function estimateLowerQuantileBaseline(
  values: ReadonlyArray<number | null>,
  options: BaselineOptions = {},
): BaselineResult {
  const windowSize = Math.max(3, Math.floor(options.windowSize ?? Math.max(9, values.length / 12)));
  const quantile = options.quantile ?? 0.02;
  const filled = fillMissing([...values]);
  const half = Math.floor(windowSize / 2);
  const baseline: number[] = [];

  for (let i = 0; i < filled.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(filled.length, i + half + 1);
    const sorted = filled.slice(start, end).sort((a, b) => a - b);
    baseline.push(Number((percentile(sorted, quantile) ?? filled[i]).toFixed(6)));
  }

  return {
    baseline,
    corrected: values.map((value, index) =>
      typeof value === "number" && Number.isFinite(value)
        ? Number((value - baseline[index]).toFixed(6))
        : null,
    ),
  };
}
