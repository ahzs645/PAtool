/**
 * AirMonitor's `QC_invalidateConsecutiveSuspectValues()` — flag runs of
 * identical "stuck" values that indicate sensor stiction. Common failure
 * mode for AIRSIS/WRCC temporary smoke monitors, but also occurs on
 * PurpleAir A/B channels when one channel fails high.
 */

export type StickyFlag = {
  index: number;
  value: number;
  runLength: number;
};

export type StickyQcResult = {
  flags: StickyFlag[];
  /** Same length as input; null where original value was invalidated. */
  values: Array<number | null>;
};

export type StickyQcOptions = {
  /** Minimum consecutive-identical run length to flag. Default 3. */
  minRun?: number;
  /** Tolerance (relative) for "equal" comparisons; default 0 (strict). */
  tolerance?: number;
  /** Optional minimum absolute value: zero-stuck periods (sensor off) may be expected and skipped. */
  ignoreZero?: boolean;
};

function approxEqual(a: number, b: number, tol: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (tol === 0) return a === b;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= tol;
}

export function qcInvalidateConsecutiveSuspectValues(
  values: ReadonlyArray<number | null>,
  options: StickyQcOptions = {},
): StickyQcResult {
  const minRun = Math.max(2, options.minRun ?? 3);
  const tol = Math.max(0, options.tolerance ?? 0);
  const ignoreZero = options.ignoreZero ?? false;
  const out = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const flags: StickyFlag[] = [];
  let runStart = 0;
  for (let i = 1; i <= out.length; i += 1) {
    const prev = out[i - 1];
    const cur = i < out.length ? out[i] : null;
    if (prev !== null && cur !== null && approxEqual(prev, cur, tol)) continue;
    const length = i - runStart;
    if (length >= minRun) {
      const baseValue = out[runStart];
      if (baseValue !== null && !(ignoreZero && baseValue === 0)) {
        for (let k = runStart; k < i; k += 1) {
          flags.push({ index: k, value: baseValue, runLength: length });
          out[k] = null;
        }
      }
    }
    runStart = i;
  }
  return { flags, values: out };
}
