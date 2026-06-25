/**
 * ASNAT-style sensor correction development (Barkjohn et al. 2025, section 2.6).
 *
 * Fits a correction model y ~ f(x [, z]) between two chosen variables (x is the
 * predictor, e.g. the sensor; y the response, e.g. the reference monitor) with
 * an optional third variable z (e.g. RH or temperature). Supported forms:
 *
 *   - single        polynomial in x only
 *   - additive      polynomial in x plus polynomial in z (no cross terms)
 *   - interactive   additive terms plus x^i * z^j cross terms
 *
 * each available as linear / quadratic / cubic. The paper's completeness gates
 * are enforced before coefficients are reported:
 *
 *   - only unflagged rows (flag status "0") are used
 *   - x and y must be non-missing
 *   - z is only included if it is >= 50% complete across matched rows
 *   - R^2 needs >= 2 rows (single) / > 15 rows (multivariable)
 *   - coefficient generation needs >= 20 (linear), >= 30 (quadratic),
 *     >= 40 (cubic) rows
 */

export type CorrectionForm = "single" | "additive" | "interactive";
export type CorrectionOrder = "linear" | "quadratic" | "cubic";

export type CorrectionInputRow = {
  x: number | null | undefined;
  y: number | null | undefined;
  z?: number | null | undefined;
  flag?: string | number | null;
};

export type CorrectionGate = { id: string; pass: boolean; detail: string };

export type CorrectionResult = {
  form: CorrectionForm;
  order: CorrectionOrder;
  terms: string[];
  coefficients: number[];
  r2: number;
  rmse: number;
  /** Normalized mean bias error of the fitted model residuals. */
  nmbe: number;
  n: number;
  usedThirdVariable: boolean;
  equation: string;
  gates: CorrectionGate[];
  canComputeR2: boolean;
  canGenerateCoefficients: boolean;
  predict: (x: number, z?: number) => number;
};

export type DevelopCorrectionOptions = {
  form?: CorrectionForm;
  order?: CorrectionOrder;
  useThirdVariable?: boolean;
  requireUnflagged?: boolean;
};

const ORDER_DEGREE: Record<CorrectionOrder, number> = { linear: 1, quadratic: 2, cubic: 3 };
const MIN_COEFFICIENT_ROWS: Record<CorrectionOrder, number> = { linear: 20, quadratic: 30, cubic: 40 };

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnflagged(flag: string | number | null | undefined): boolean {
  if (flag === undefined || flag === null || flag === "") return true;
  if (typeof flag === "number") return flag === 0;
  return flag.trim() === "0" || flag.trim() === "";
}

type TermSpec = { label: string; evaluate: (x: number, z: number) => number };

function buildTerms(form: CorrectionForm, degree: number, withZ: boolean): TermSpec[] {
  const terms: TermSpec[] = [{ label: "1", evaluate: () => 1 }];
  for (let i = 1; i <= degree; i += 1) {
    terms.push({ label: i === 1 ? "x" : `x^${i}`, evaluate: (x) => x ** i });
  }
  if (form !== "single" && withZ) {
    for (let j = 1; j <= degree; j += 1) {
      terms.push({ label: j === 1 ? "z" : `z^${j}`, evaluate: (_x, z) => z ** j });
    }
    if (form === "interactive") {
      for (let i = 1; i <= degree; i += 1) {
        for (let j = 1; j <= degree; j += 1) {
          const label = `${i === 1 ? "x" : `x^${i}`}*${j === 1 ? "z" : `z^${j}`}`;
          terms.push({ label, evaluate: (x, z) => x ** i * z ** j });
        }
      }
    }
  }
  return terms;
}

/** Solve A·beta = b for symmetric positive design via Gaussian elimination. */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  // After full elimination the matrix is diagonal: beta_i = rhs_i / m[i][i].
  const beta = new Array<number>(n);
  for (let i = 0; i < n; i += 1) beta[i] = m[i][n] / m[i][i];
  return beta;
}

function leastSquares(design: number[][], y: number[]): number[] | null {
  const m = design[0].length;
  const ata: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const aty: number[] = new Array(m).fill(0);
  for (let r = 0; r < design.length; r += 1) {
    for (let i = 0; i < m; i += 1) {
      aty[i] += design[r][i] * y[r];
      for (let j = 0; j < m; j += 1) ata[i][j] += design[r][i] * design[r][j];
    }
  }
  return solveLinearSystem(ata, aty);
}

function formatEquation(terms: string[], coefficients: number[]): string {
  const parts = terms.map((term, i) => {
    const c = Number(coefficients[i].toFixed(4));
    if (term === "1") return `${c}`;
    return `${c >= 0 ? "+ " : "- "}${Math.abs(c)}*${term}`;
  });
  return `y = ${parts.join(" ")}`.replace("y = + ", "y = ");
}

export function developCorrection(
  rows: readonly CorrectionInputRow[],
  options: DevelopCorrectionOptions = {},
): CorrectionResult {
  const form = options.form ?? "single";
  const order = options.order ?? "linear";
  const degree = ORDER_DEGREE[order];
  const requireUnflagged = options.requireUnflagged ?? true;
  const wantsZ = form !== "single" && (options.useThirdVariable ?? true);
  const gates: CorrectionGate[] = [];

  // Gate: unflagged + non-missing x/y.
  const base = rows.filter((row) => {
    if (requireUnflagged && !isUnflagged(row.flag)) return false;
    return isNum(row.x) && isNum(row.y);
  });
  gates.push({ id: "completeness-xy", pass: base.length > 0, detail: `${base.length} rows with non-missing X and Y (unflagged)` });

  // Gate: third-variable completeness (>= 50%).
  let usedThirdVariable = false;
  if (wantsZ) {
    const zComplete = base.filter((row) => isNum(row.z)).length;
    const fraction = base.length ? zComplete / base.length : 0;
    usedThirdVariable = fraction >= 0.5;
    gates.push({
      id: "completeness-z",
      pass: usedThirdVariable,
      detail: `Z is ${(fraction * 100).toFixed(0)}% complete (needs >= 50% to be included)`,
    });
  }

  const usable = usedThirdVariable ? base.filter((row) => isNum(row.z)) : base;
  const xs = usable.map((row) => row.x as number);
  const ys = usable.map((row) => row.y as number);
  const zs = usable.map((row) => (isNum(row.z) ? (row.z as number) : 0));
  const n = usable.length;

  const effectiveForm: CorrectionForm = usedThirdVariable ? form : "single";
  const terms = buildTerms(effectiveForm, degree, usedThirdVariable);

  const isMultivariable = effectiveForm !== "single";
  const minR2Rows = isMultivariable ? 16 : 2;
  const minCoefficientRows = MIN_COEFFICIENT_ROWS[order];
  const canComputeR2 = n >= minR2Rows && n >= terms.length;
  const canGenerateCoefficients = n >= minCoefficientRows && n >= terms.length;
  gates.push({ id: "min-rows-r2", pass: n >= minR2Rows, detail: `${n} rows (R^2 needs >= ${minR2Rows})` });
  gates.push({ id: "min-rows-coefficients", pass: n >= minCoefficientRows, detail: `${n} rows (coefficients need >= ${minCoefficientRows})` });

  const design = usable.map((_, r) => terms.map((term) => term.evaluate(xs[r], zs[r])));
  const coefficients = n >= terms.length ? leastSquares(design, ys) : null;

  if (!coefficients) {
    return {
      form: effectiveForm,
      order,
      terms: terms.map((t) => t.label),
      coefficients: [],
      r2: NaN,
      rmse: NaN,
      nmbe: NaN,
      n,
      usedThirdVariable,
      equation: "insufficient data",
      gates,
      canComputeR2: false,
      canGenerateCoefficients: false,
      predict: () => NaN,
    };
  }

  const predict = (x: number, z = 0) => terms.reduce((sum, term, i) => sum + coefficients[i] * term.evaluate(x, z), 0);
  const predictions = usable.map((_, r) => predict(xs[r], zs[r]));
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  let biasSum = 0;
  for (let r = 0; r < n; r += 1) {
    ssRes += (ys[r] - predictions[r]) ** 2;
    ssTot += (ys[r] - yMean) ** 2;
    biasSum += predictions[r] - ys[r];
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / n);
  const nmbe = yMean === 0 ? 0 : (biasSum / n) / yMean;

  return {
    form: effectiveForm,
    order,
    terms: terms.map((t) => t.label),
    coefficients: coefficients.map((c) => Number(c.toFixed(6))),
    r2: Number(r2.toFixed(6)),
    rmse: Number(rmse.toFixed(6)),
    nmbe: Number(nmbe.toFixed(6)),
    n,
    usedThirdVariable,
    equation: formatEquation(terms.map((t) => t.label), coefficients),
    gates,
    canComputeR2,
    canGenerateCoefficients,
    predict,
  };
}

/** Serialize a correction for export (the paper's "export the corrections"). */
export function exportCorrection(result: CorrectionResult, meta: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      ...meta,
      form: result.form,
      order: result.order,
      terms: result.terms,
      coefficients: result.coefficients,
      equation: result.equation,
      usedThirdVariable: result.usedThirdVariable,
      statistics: { r2: result.r2, rmse: result.rmse, nmbe: result.nmbe, n: result.n },
      gates: result.gates,
    },
    null,
    2,
  );
}
