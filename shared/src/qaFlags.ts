export type SentinelQaFlag =
  | "Calibration"
  | "Interference"
  | "Maintenance"
  | "Malfunction"
  | "Other"
  | "WD_Interference"
  | "WD_Error"
  | "WS_repeat"
  | "WD_repeat"
  | "Sig_repeat"
  | "WS_offscale"
  | "WD_offscale"
  | "Missing_Signal"
  | (string & {});

export type SentinelQaRecord = {
  signal: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  qaFlags: SentinelQaFlag[];
};

export type SentinelQaSummary = {
  totalRows: number;
  passRows: number;
  flaggedRows: number;
  counts: Record<string, number>;
};

const REPEAT_THRESHOLD = 30;
const WIND_SPEED_OFFSCALE_MPS = 40;

function appendFlag(flags: SentinelQaFlag[], flag: SentinelQaFlag): SentinelQaFlag[] {
  return flags.includes(flag) ? flags : [...flags, flag];
}

function flagRepeats<T extends SentinelQaRecord>(
  records: T[],
  getValue: (record: T) => number | null,
  flag: SentinelQaFlag,
): T[] {
  let start = 0;
  while (start < records.length) {
    const value = getValue(records[start]);
    let end = start + 1;
    while (end < records.length && getValue(records[end]) === value) end += 1;
    if (value !== null && value !== 0 && end - start > REPEAT_THRESHOLD) {
      for (let i = start; i < end; i += 1) {
        records[i] = { ...records[i], qaFlags: appendFlag(records[i].qaFlags, flag) };
      }
    }
    start = end;
  }
  return records;
}

export function applySentinelAutoQaFlags<T extends SentinelQaRecord>(input: readonly T[]): T[] {
  let records = input.map((record) => ({ ...record, qaFlags: [...record.qaFlags] }));
  records = flagRepeats(records, (record) => record.windSpeed, "WS_repeat");
  records = flagRepeats(records, (record) => record.windDirection, "WD_repeat");
  records = flagRepeats(records, (record) => record.signal, "Sig_repeat");

  return records.map((record) => {
    let qaFlags = record.qaFlags;
    if (record.windSpeed !== null && record.windSpeed > WIND_SPEED_OFFSCALE_MPS) qaFlags = appendFlag(qaFlags, "WS_offscale");
    if (record.windDirection !== null && (record.windDirection < 0 || record.windDirection > 360)) {
      qaFlags = appendFlag(qaFlags, "WD_offscale");
    }
    if (record.signal === null) qaFlags = appendFlag(qaFlags, "Missing_Signal");
    return qaFlags === record.qaFlags ? record : { ...record, qaFlags };
  });
}

export function hasQaPass(record: SentinelQaRecord): boolean {
  return record.qaFlags.length === 0 || record.qaFlags.every((flag) => flag.toLowerCase() === "none");
}

export function filterSentinelQa<T extends SentinelQaRecord>(
  records: readonly T[],
  options: { qaPassOnly?: boolean; minWindSpeedMps?: number } = {},
): T[] {
  return records.filter((record) => {
    if (options.qaPassOnly && !hasQaPass(record)) return false;
    if (options.minWindSpeedMps !== undefined && (record.windSpeed === null || record.windSpeed < options.minWindSpeedMps)) {
      return false;
    }
    return true;
  });
}

export function summarizeSentinelQa(records: readonly SentinelQaRecord[]): SentinelQaSummary {
  const counts: Record<string, number> = {};
  let passRows = 0;

  for (const record of records) {
    if (hasQaPass(record)) {
      passRows += 1;
      continue;
    }
    for (const flag of record.qaFlags) {
      counts[flag] = (counts[flag] ?? 0) + 1;
    }
  }

  return {
    totalRows: records.length,
    passRows,
    flaggedRows: records.length - passRows,
    counts,
  };
}

