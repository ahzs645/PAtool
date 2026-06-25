/**
 * ASNAT-compatible flagging engine.
 *
 * Reproduces the numeric flag-code scheme documented in Barkjohn et al. 2025
 * ("Air Sensor Network Analysis Tool", Table S2). Flags are integer codes:
 *
 *   0        unflagged
 *   1-79     user-defined Boolean conditions (one code per condition, in order)
 *   60       invalid negative pollutant value
 *   65       temporal inconsistency (non-monotonic / unordered timestamp)
 *   70 / 71  sudden spike / sudden drop vs the trailing window mean
 *   72       inconsistent daily ozone pattern (night > daytime median + 1.5*sd)
 *   73       inconsistent daily PM pattern (afternoon > morning/night + 1.5*sd)
 *   80 / 81  neighbor absolute / percent difference over threshold
 *   82       neighbor pair R^2 below threshold (flags every row of the pair)
 *   83       constant value persisting for >= x consecutive identical samples
 *   84       missing data for >= x consecutive samples
 *   85       statistical outlier |value - mean| > k * sd (optional time window)
 *   86       Hampel-filter outlier (rolling median + MAD)
 *   90       duplicate timestamp at the same location
 *   95       malformed timestamp (not YYYY-MM-DDTHH:MM:SS-0000)
 *
 * The exported `flagAsnatSeries` produces a `flagged(-)` column where the codes
 * for each row are sorted ascending and joined with semicolons (or "0").
 */

export type AsnatRow = {
  timestamp: string;
  id?: string | number | null;
  longitude?: number | null;
  latitude?: number | null;
  elevation?: number | null;
  [column: string]: unknown;
};

export type FlaggedRow = {
  flags: number[];
  /** Semicolon-joined ascending codes, or "0" when unflagged. */
  code: string;
};

// ---------------------------------------------------------------------------
// Boolean expression engine (user-defined conditions, codes 1-79)
// ---------------------------------------------------------------------------

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "date"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" };

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}(:\d{2}(:\d{2})?)?([+-]\d{2}:?\d{2}|Z)?/;
const NUMBER_RE = /^\d+(\.\d+)?([eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPERATORS = ["<=", ">=", "!=", "==", "&&", "||", "=", "<", ">", "+", "-", "*", "/", "^"];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = rest[0];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === "(") { tokens.push({ kind: "lparen" }); i += 1; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen" }); i += 1; continue; }
    if (ch === '"' || ch === "'") {
      const end = rest.indexOf(ch, 1);
      if (end === -1) throw new Error("Unterminated string literal");
      tokens.push({ kind: "str", value: rest.slice(1, end) });
      i += end + 1;
      continue;
    }
    const dt = DATETIME_RE.exec(rest);
    if (dt) {
      const parsed = Date.parse(dt[0]);
      tokens.push({ kind: "date", value: Number.isNaN(parsed) ? NaN : parsed });
      i += dt[0].length;
      continue;
    }
    const num = NUMBER_RE.exec(rest);
    if (num) { tokens.push({ kind: "num", value: Number(num[0]) }); i += num[0].length; continue; }
    const op = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (op) { tokens.push({ kind: "op", value: op }); i += op.length; continue; }
    const ident = IDENT_RE.exec(rest);
    if (ident) {
      const word = ident[0];
      const lower = word.toLowerCase();
      if (lower === "and") tokens.push({ kind: "op", value: "&&" });
      else if (lower === "or") tokens.push({ kind: "op", value: "||" });
      else tokens.push({ kind: "ident", value: word });
      i += word.length;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in flag expression`);
  }
  return tokens;
}

type Ast =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "date"; value: number }
  | { type: "ident"; name: string }
  | { type: "unary"; op: string; operand: Ast }
  | { type: "binary"; op: string; left: Ast; right: Ast };

// Precedence (low -> high): || , && , comparisons , +- , */ , ^ (right assoc),
// unary -. This evaluates every documented ASNAT example correctly
// (2 + 3*4 = 14; 2^3^2 = 512; "(id=.. or id=..) and count<25").
function parseExpression(tokens: Token[]): Ast {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function parseOr(): Ast {
    let node = parseAnd();
    while (peek()?.kind === "op" && (peek() as { value: string }).value === "||") {
      eat();
      node = { type: "binary", op: "||", left: node, right: parseAnd() };
    }
    return node;
  }
  function parseAnd(): Ast {
    let node = parseComparison();
    while (peek()?.kind === "op" && (peek() as { value: string }).value === "&&") {
      eat();
      node = { type: "binary", op: "&&", left: node, right: parseComparison() };
    }
    return node;
  }
  function parseComparison(): Ast {
    let node = parseAdditive();
    while (peek()?.kind === "op" && ["=", "==", "!=", "<", "<=", ">", ">="].includes((peek() as { value: string }).value)) {
      const op = (eat() as { value: string }).value;
      node = { type: "binary", op: op === "==" ? "=" : op, left: node, right: parseAdditive() };
    }
    return node;
  }
  function parseAdditive(): Ast {
    let node = parseMultiplicative();
    while (peek()?.kind === "op" && ["+", "-"].includes((peek() as { value: string }).value)) {
      const op = (eat() as { value: string }).value;
      node = { type: "binary", op, left: node, right: parseMultiplicative() };
    }
    return node;
  }
  function parseMultiplicative(): Ast {
    let node = parsePower();
    while (peek()?.kind === "op" && ["*", "/"].includes((peek() as { value: string }).value)) {
      const op = (eat() as { value: string }).value;
      node = { type: "binary", op, left: node, right: parsePower() };
    }
    return node;
  }
  function parsePower(): Ast {
    const node = parseUnary();
    if (peek()?.kind === "op" && (peek() as { value: string }).value === "^") {
      eat();
      return { type: "binary", op: "^", left: node, right: parsePower() }; // right-assoc
    }
    return node;
  }
  function parseUnary(): Ast {
    if (peek()?.kind === "op" && (peek() as { value: string }).value === "-") {
      eat();
      return { type: "unary", op: "-", operand: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary(): Ast {
    const token = eat();
    if (!token) throw new Error("Unexpected end of flag expression");
    if (token.kind === "num") return { type: "num", value: token.value };
    if (token.kind === "str") return { type: "str", value: token.value };
    if (token.kind === "date") return { type: "date", value: token.value };
    if (token.kind === "ident") return { type: "ident", name: token.value };
    if (token.kind === "lparen") {
      const node = parseOr();
      if (peek()?.kind !== "rparen") throw new Error("Missing closing parenthesis");
      eat();
      return node;
    }
    throw new Error(`Unexpected token in flag expression: ${JSON.stringify(token)}`);
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw new Error("Trailing tokens in flag expression");
  return ast;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return NaN;
}

function looksNumeric(value: unknown): boolean {
  return !Number.isNaN(asNumber(value));
}

function compare(op: string, left: unknown, right: unknown): boolean {
  // Numeric comparison when both sides are numeric (or numeric strings).
  if (looksNumeric(left) && looksNumeric(right)) {
    const a = asNumber(left);
    const b = asNumber(right);
    switch (op) {
      case "=": return a === b;
      case "!=": return a !== b;
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      case ">=": return a >= b;
    }
  }
  const a = String(left ?? "");
  const b = String(right ?? "");
  switch (op) {
    case "=": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    default: return false;
  }
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value !== "";
  return Boolean(value);
}

function evaluate(ast: Ast, row: AsnatRow): unknown {
  switch (ast.type) {
    case "num": return ast.value;
    case "str": return ast.value;
    case "date": return ast.value;
    case "ident": {
      // `timestamp` resolves to epoch ms so it can be compared with date literals.
      if (ast.name === "timestamp") {
        const parsed = Date.parse(String(row.timestamp));
        return Number.isNaN(parsed) ? row.timestamp : parsed;
      }
      return row[ast.name] as unknown;
    }
    case "unary": {
      const operand = evaluate(ast.operand, row);
      return ast.op === "-" ? -asNumber(operand) : operand;
    }
    case "binary": {
      if (ast.op === "&&") return truthy(evaluate(ast.left, row)) && truthy(evaluate(ast.right, row));
      if (ast.op === "||") return truthy(evaluate(ast.left, row)) || truthy(evaluate(ast.right, row));
      const left = evaluate(ast.left, row);
      const right = evaluate(ast.right, row);
      if (["=", "!=", "<", "<=", ">", ">="].includes(ast.op)) return compare(ast.op, left, right);
      const a = asNumber(left);
      const b = asNumber(right);
      switch (ast.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "^": return Math.pow(a, b);
        default: return NaN;
      }
    }
  }
}

/** Compile a user flag expression into a row predicate. Throws on parse error. */
export function compileFlagExpression(source: string): (row: AsnatRow) => boolean {
  // Strip a leading "#comment" header line if present (ASNAT flags.txt style).
  const cleaned = source.replace(/^\s*#[^\n]*\n?/g, "").trim();
  const ast = parseExpression(tokenize(cleaned));
  return (row: AsnatRow) => truthy(evaluate(ast, row));
}

export function evaluateFlagExpression(source: string, row: AsnatRow): boolean {
  return compileFlagExpression(source)(row);
}

// ---------------------------------------------------------------------------
// Built-in numeric flags
// ---------------------------------------------------------------------------

export type AsnatFlagOptions = {
  valueField?: string;
  pollutant?: "pm" | "ozone" | "other";
  timezoneOffsetHours?: number;
  negative?: boolean;                 // 60
  temporalOrder?: boolean;            // 65
  spike?: { window: number; threshold: number } | null; // 70/71
  dailyPattern?: boolean;             // 72/73
  constantRun?: number | null;        // 83
  missingRun?: number | null;         // 84
  zScore?: { k: number; window?: [string, string] } | null; // 85
  hampel?: { window: number; threshold: number } | null;    // 86
  duplicateLocation?: boolean;        // 90
  dateFormat?: boolean;               // 95
  userExpressions?: string[];         // 1-79
};

const STRICT_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/;

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function utcHour(timestamp: string, offsetHours: number): number {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return NaN;
  return new Date(t + offsetHours * 3_600_000).getUTCHours();
}
function utcDay(timestamp: string, offsetHours: number): string {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return "invalid";
  return new Date(t + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const k = key(row);
    const bucket = groups.get(k) ?? [];
    bucket.push(index);
    groups.set(k, bucket);
  });
  return groups;
}

/**
 * Apply ASNAT built-in + user flags to a single-variable series and return
 * aligned per-row flag codes. Rows are grouped by station id; time-ordered
 * flags sort each station's rows by timestamp.
 */
export function flagAsnatSeries(rows: AsnatRow[], options: AsnatFlagOptions = {}): FlaggedRow[] {
  const valueField = options.valueField ?? "value";
  const offset = options.timezoneOffsetHours ?? 0;
  const flags: Set<number>[] = rows.map(() => new Set<number>());
  const valueAt = (index: number) => rows[index][valueField];

  // 60 — invalid negative values.
  if (options.negative) {
    rows.forEach((_, index) => {
      const v = valueAt(index);
      if (isNum(v) && v < 0) flags[index].add(60);
    });
  }

  // 95 — malformed timestamp (not YYYY-MM-DDTHH:MM:SS-0000).
  if (options.dateFormat) {
    rows.forEach((row, index) => {
      if (!STRICT_TIMESTAMP_RE.test(String(row.timestamp))) flags[index].add(95);
    });
  }

  // 90 — duplicate timestamp at the same location.
  if (options.duplicateLocation) {
    const seen = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const key = `${row.timestamp}|${row.longitude ?? ""}|${row.latitude ?? ""}|${row.elevation ?? ""}`;
      const bucket = seen.get(key) ?? [];
      bucket.push(index);
      seen.set(key, bucket);
    });
    for (const indices of seen.values()) {
      if (indices.length > 1) for (const index of indices) flags[index].add(90);
    }
  }

  const stations = groupBy(rows, (row) => String(row.id ?? ""));

  for (const indices of stations.values()) {
    const ordered = [...indices].sort((a, b) => Date.parse(rows[a].timestamp) - Date.parse(rows[b].timestamp));

    // 65 — temporal inconsistency (timestamp not strictly increasing).
    if (options.temporalOrder) {
      for (let k = 1; k < indices.length; k += 1) {
        if (Date.parse(rows[indices[k]].timestamp) <= Date.parse(rows[indices[k - 1]].timestamp)) {
          flags[indices[k]].add(65);
        }
      }
    }

    // 83 — constant run of >= x identical consecutive values.
    if (options.constantRun && options.constantRun > 0) {
      let runStart = 0;
      while (runStart < ordered.length) {
        const v = valueAt(ordered[runStart]);
        let runEnd = runStart + 1;
        while (runEnd < ordered.length && valueAt(ordered[runEnd]) === v) runEnd += 1;
        if (isNum(v) && runEnd - runStart >= options.constantRun) {
          for (let k = runStart; k < runEnd; k += 1) flags[ordered[k]].add(83);
        }
        runStart = runEnd;
      }
    }

    // 84 — consecutive missing run of >= x.
    if (options.missingRun && options.missingRun > 0) {
      let runStart = 0;
      while (runStart < ordered.length) {
        const missing = !isNum(valueAt(ordered[runStart]));
        let runEnd = runStart + 1;
        while (runEnd < ordered.length && (!isNum(valueAt(ordered[runEnd]))) === missing) runEnd += 1;
        if (missing && runEnd - runStart >= options.missingRun) {
          for (let k = runStart; k < runEnd; k += 1) flags[ordered[k]].add(84);
        }
        runStart = runEnd;
      }
    }

    // 70 / 71 — sudden spike / drop vs the trailing window mean.
    if (options.spike) {
      const { window, threshold } = options.spike;
      for (let k = 0; k < ordered.length; k += 1) {
        const current = valueAt(ordered[k]);
        if (!isNum(current)) continue;
        const prior: number[] = [];
        for (let j = Math.max(0, k - window); j < k; j += 1) {
          const v = valueAt(ordered[j]);
          if (isNum(v)) prior.push(v);
        }
        if (!prior.length) continue;
        const avg = mean(prior);
        if (avg === 0) continue;
        const change = (current - avg) / Math.abs(avg);
        if (change > threshold) flags[ordered[k]].add(70);
        else if (change < -threshold) flags[ordered[k]].add(71);
      }
    }

    // 85 — statistical outlier |value - mean| > k * sd (optional time window).
    if (options.zScore) {
      const { k, window } = options.zScore;
      const inWindow = (index: number) => {
        if (!window) return true;
        const t = Date.parse(rows[index].timestamp);
        return t >= Date.parse(window[0]) && t <= Date.parse(window[1]);
      };
      const sampleIdx = ordered.filter((index) => isNum(valueAt(index)) && inWindow(index));
      const sample = sampleIdx.map((index) => valueAt(index) as number);
      const m = mean(sample);
      const sd = stddev(sample);
      if (sd > 0) {
        for (const index of sampleIdx) {
          if (Math.abs((valueAt(index) as number) - m) > k * sd) flags[index].add(85);
        }
      }
    }

    // 86 — Hampel filter (rolling median + MAD).
    if (options.hampel) {
      const { window, threshold } = options.hampel;
      const valid = ordered.filter((index) => isNum(valueAt(index)));
      for (let k = 0; k < valid.length; k += 1) {
        const lo = Math.max(0, k - window);
        const hi = Math.min(valid.length - 1, k + window);
        const neighborhood: number[] = [];
        for (let j = lo; j <= hi; j += 1) neighborhood.push(valueAt(valid[j]) as number);
        const med = median(neighborhood);
        const mad = median(neighborhood.map((v) => Math.abs(v - med)));
        const scaled = 1.4826 * mad;
        if (scaled > 0 && Math.abs((valueAt(valid[k]) as number) - med) > threshold * scaled) {
          flags[valid[k]].add(86);
        }
      }
    }

    // 72 / 73 — inconsistent daily pattern.
    if (options.dailyPattern && options.pollutant !== "other") {
      const days = groupBy(ordered.map((index) => ({ index })), (row) => utcDay(rows[row.index].timestamp, offset));
      for (const dayIndices of days.values()) {
        const realIdx = dayIndices.map((meta) => ordered[meta]);
        const valuesInHours = (lo: number, hi: number) =>
          realIdx.filter((index) => {
            const h = utcHour(rows[index].timestamp, offset);
            return h >= lo && h <= hi && isNum(valueAt(index));
          });
        if (options.pollutant === "ozone") {
          const daytime = valuesInHours(6, 18).map((index) => valueAt(index) as number);
          const threshold = median(daytime) + 1.5 * stddev(daytime);
          if (daytime.length) {
            for (const index of valuesInHours(0, 5)) {
              if ((valueAt(index) as number) > threshold) flags[index].add(72);
            }
          }
        } else {
          const morning = valuesInHours(7, 10).map((index) => valueAt(index) as number);
          const night = valuesInHours(21, 23).map((index) => valueAt(index) as number);
          const morningThreshold = median(morning) + 1.5 * stddev(morning);
          const nightThreshold = median(night) + 1.5 * stddev(night);
          for (const index of valuesInHours(15, 17)) {
            const v = valueAt(index) as number;
            if ((morning.length && v > morningThreshold) || (night.length && v > nightThreshold)) {
              flags[index].add(73);
            }
          }
        }
      }
    }
  }

  // 1-79 — user-defined Boolean conditions, in order.
  if (options.userExpressions?.length) {
    const predicates = options.userExpressions.map((source, i) => ({ code: i + 1, predicate: compileFlagExpression(source) }));
    rows.forEach((row, index) => {
      for (const { code, predicate } of predicates) {
        if (code <= 79 && predicate(row)) flags[index].add(code);
      }
    });
  }

  return flags.map((set) => {
    const sorted = [...set].sort((a, b) => a - b);
    return { flags: sorted, code: sorted.length ? sorted.join(";") : "0" };
  });
}

// ---------------------------------------------------------------------------
// Neighbor flags (80 / 81 / 82) — operate on matched X/Y pairs
// ---------------------------------------------------------------------------

export type NeighborPairSample = { x: number; y: number };
export type NeighborFlagThresholds = {
  maxDifference?: number;       // 80
  maxPercentDifference?: number; // 81 (symmetric %, 0-100 scale)
  minRSquared?: number;        // 82 (flags the whole pair)
};

export type NeighborFlagResult = { flags: number[]; code: string }[];

function rSquared(samples: NeighborPairSample[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  const xs = samples.map((s) => s.x);
  const ys = samples.map((s) => s.y);
  const mx = mean(xs);
  const my = mean(ys);
  let ssXX = 0;
  let ssYY = 0;
  let ssXY = 0;
  for (let i = 0; i < n; i += 1) {
    ssXX += (xs[i] - mx) ** 2;
    ssYY += (ys[i] - my) ** 2;
    ssXY += (xs[i] - mx) * (ys[i] - my);
  }
  if (ssXX === 0 || ssYY === 0) return 0;
  return (ssXY * ssXY) / (ssXX * ssYY);
}

/** Apply neighbor flags 80/81/82 to a set of matched X/Y samples for one pair. */
export function flagNeighborPair(samples: NeighborPairSample[], thresholds: NeighborFlagThresholds): NeighborFlagResult {
  const flags: Set<number>[] = samples.map(() => new Set<number>());
  const pairBad = thresholds.minRSquared !== undefined && rSquared(samples) < thresholds.minRSquared;
  samples.forEach((sample, index) => {
    const diff = Math.abs(sample.x - sample.y);
    if (thresholds.maxDifference !== undefined && diff > thresholds.maxDifference) flags[index].add(80);
    const denom = Math.abs(sample.x) + Math.abs(sample.y);
    const pct = denom === 0 ? 0 : (diff * 2 * 100) / denom;
    if (thresholds.maxPercentDifference !== undefined && pct > thresholds.maxPercentDifference) flags[index].add(81);
    if (pairBad) flags[index].add(82);
  });
  return flags.map((set) => {
    const sorted = [...set].sort((a, b) => a - b);
    return { flags: sorted, code: sorted.length ? sorted.join(";") : "0" };
  });
}

// ---------------------------------------------------------------------------
// flags.txt export
// ---------------------------------------------------------------------------

/** Serialize user Boolean conditions to ASNAT's flags.txt format. */
export function exportFlagConditions(expressions: string[]): string {
  return expressions
    .map((expression, i) => `#flag condition ${i + 1}\n${expression.trim()}`)
    .join("\n");
}
