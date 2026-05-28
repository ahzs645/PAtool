/**
 * Pre-industrial baseline reconstruction from paleoclimatological
 * proxies, inspired by biteSizedAQ notebook #19. We don't ingest ice
 * core data directly — instead this module ships a small set of
 * accepted proxy anchors and offers a function that turns any modern
 * PM2.5 observation into a fold-above-baseline factor.
 *
 * Anchors (annual PM2.5-equivalent, µg/m³):
 *   - Holocene background (pre-1750)  : 3
 *   - 1850 industrial dawn            : 6
 *   - 1950 mid-century                 : 14
 *   - 1990 pre-clean-air-acts          : 22
 *   - 2024 WHO AQG                     : 5
 *
 * These come from a synthesis of EPICA / Greenland ice core sulfate +
 * black-carbon depositions, but treat them as order-of-magnitude only.
 */

export type PaleoBaselineEra =
  | "holocene"
  | "industrial-dawn"
  | "mid-century"
  | "pre-clean-air-acts"
  | "who-aqg-2021";

const ANCHORS: Record<PaleoBaselineEra, { yearLabel: string; pm25: number }> = {
  holocene: { yearLabel: "pre-1750", pm25: 3 },
  "industrial-dawn": { yearLabel: "≈ 1850", pm25: 6 },
  "mid-century": { yearLabel: "≈ 1950", pm25: 14 },
  "pre-clean-air-acts": { yearLabel: "≈ 1990", pm25: 22 },
  "who-aqg-2021": { yearLabel: "2021", pm25: 5 },
};

export function paleoBaseline(era: PaleoBaselineEra): { yearLabel: string; pm25: number } {
  return ANCHORS[era];
}

export function paleoFoldAboveBaseline(
  observedPm25: number,
  baseline: PaleoBaselineEra = "holocene",
): number {
  const base = ANCHORS[baseline].pm25;
  if (!Number.isFinite(observedPm25) || base <= 0) return 0;
  return observedPm25 / base;
}

export type PaleoTimelinePoint = {
  era: PaleoBaselineEra;
  yearLabel: string;
  pm25: number;
};

export function paleoTimeline(): PaleoTimelinePoint[] {
  return (Object.entries(ANCHORS) as Array<[PaleoBaselineEra, { yearLabel: string; pm25: number }]>)
    .map(([era, v]) => ({ era, ...v }));
}
