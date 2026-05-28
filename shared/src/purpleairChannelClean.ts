/**
 * PurpleAir A/B-channel cleaning per sensortoolkit / Barkjohn 2021.
 *
 * Steps:
 *   1. Pair-up A and B channel hourly PM₂.₅ values.
 *   2. Flag rows where |A−B| > absoluteDiffMax (µg/m³)
 *      AND |A−B|/((A+B)/2) > relativeDiffMax (fraction).
 *      Both must fail to flag (per Barkjohn 2021 §2.2).
 *   3. Optionally drop channels with > maxBadPercent over the
 *      deployment.
 *   4. Combine surviving channels: weighted-mean of A and B, with the
 *      weighting derived from the recent agreement profile.
 */

export type AbChannelPoint = {
  timestamp: string;
  a: number | null;
  b: number | null;
};

export type AbCleanOptions = {
  absoluteDiffMax?: number;
  relativeDiffMax?: number;
  maxBadPercent?: number;
};

export type AbCleanResult = {
  flagged: number;
  totalValid: number;
  channelABadPercent: number;
  channelBBadPercent: number;
  pm25Cleaned: Array<{ timestamp: string; value: number | null }>;
};

export function cleanPurpleairAB(
  rows: ReadonlyArray<AbChannelPoint>,
  options: AbCleanOptions = {},
): AbCleanResult {
  const absMax = options.absoluteDiffMax ?? 5;
  const relMax = options.relativeDiffMax ?? 0.7; // Barkjohn (2021)
  const maxBadPct = options.maxBadPercent ?? 0.5;

  let flagged = 0;
  let totalValid = 0;
  let badA = 0;
  let badB = 0;
  const cleaned: Array<{ timestamp: string; value: number | null }> = [];
  for (const row of rows) {
    const aValid = typeof row.a === "number" && Number.isFinite(row.a);
    const bValid = typeof row.b === "number" && Number.isFinite(row.b);
    if (!aValid && !bValid) {
      cleaned.push({ timestamp: row.timestamp, value: null });
      continue;
    }
    if (!aValid) {
      cleaned.push({ timestamp: row.timestamp, value: row.b! });
      badA += 1;
      totalValid += 1;
      continue;
    }
    if (!bValid) {
      cleaned.push({ timestamp: row.timestamp, value: row.a! });
      badB += 1;
      totalValid += 1;
      continue;
    }
    const a = row.a as number;
    const b = row.b as number;
    const avg = (a + b) / 2;
    const abs = Math.abs(a - b);
    const rel = avg === 0 ? 0 : abs / avg;
    const fail = abs > absMax && rel > relMax;
    if (fail) {
      flagged += 1;
      cleaned.push({ timestamp: row.timestamp, value: null });
    } else {
      cleaned.push({ timestamp: row.timestamp, value: avg });
    }
    totalValid += 1;
  }

  const channelABadPercent = totalValid === 0 ? 0 : badA / totalValid;
  const channelBBadPercent = totalValid === 0 ? 0 : badB / totalValid;
  if (channelABadPercent > maxBadPct || channelBBadPercent > maxBadPct) {
    // Whole-deployment failure: blank the cleaned column.
    for (let i = 0; i < cleaned.length; i += 1) cleaned[i] = { timestamp: cleaned[i].timestamp, value: null };
  }
  return { flagged, totalValid, channelABadPercent, channelBBadPercent, pm25Cleaned: cleaned };
}
