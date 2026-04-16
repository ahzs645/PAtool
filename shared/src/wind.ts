import type { PatSeries } from "./domain";

export type WindDataPoint = {
  timestamp: string;
  windDirection: number;
  windSpeed: number;
  pm25: number;
};

export type WindRoseSector = {
  direction: string;
  directionDeg: number;
  speedBins: Array<{
    label: string;
    count: number;
    meanPm25: number;
  }>;
  totalCount: number;
};

export type WindRoseData = {
  sensorId: string;
  source: "synthetic" | "observed";
  sourceLabel: string;
  totalPoints: number;
  sectors: WindRoseSector[];
  speedBinLabels: string[];
};

export type PolarPlotData = {
  sensorId: string;
  source: "synthetic" | "observed";
  sourceLabel: string;
  points: Array<[number, number, number]>;
  maxSpeed: number;
  maxPm25: number;
};

const WIND_DIRECTIONS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

const SPEED_BINS = [
  { label: "0-2", min: 0, max: 2 },
  { label: "2-4", min: 2, max: 4 },
  { label: "4-6", min: 4, max: 6 },
  { label: "6-10", min: 6, max: 10 },
  { label: "10+", min: 10, max: Infinity },
];

const SYNTHETIC_WIND_LABEL = "Synthetic wind generated from PAT timestamp and weather fields";

export function generateSyntheticWindData(series: PatSeries): WindDataPoint[] {
  return series.points
    .filter((p) => p.pm25A !== null || p.pm25B !== null)
    .map((p) => {
      const ts = new Date(p.timestamp);
      const hour = ts.getUTCHours();
      const minuteSeed = ts.getUTCMinutes();

      const hash = (ts.getTime() * 2654435761) >>> 0;
      const rand1 = (hash & 0xffff) / 0xffff;
      const rand2 = ((hash >>> 16) & 0xffff) / 0xffff;

      const baseDirection = 270;
      const diurnalShift = Math.sin((hour / 24) * Math.PI * 2) * 60;
      const noise = (rand1 - 0.5) * 90;
      const tempInfluence = ((p.temperature ?? 70) - 70) * 0.5;
      const direction = ((baseDirection + diurnalShift + noise + tempInfluence) % 360 + 360) % 360;

      const diurnalSpeed = 2 + Math.sin(((hour - 6) / 24) * Math.PI * 2) * 3;
      const humidityDrag = ((p.humidity ?? 50) - 50) * -0.02;
      const speedNoise = rand2 * 4;
      const speed = Math.max(0, diurnalSpeed + humidityDrag + speedNoise + minuteSeed * 0.01);

      const pm25 = ((p.pm25A ?? 0) + (p.pm25B ?? 0)) / 2;

      return {
        timestamp: p.timestamp,
        windDirection: Number(direction.toFixed(1)),
        windSpeed: Number(speed.toFixed(2)),
        pm25: Number(pm25.toFixed(2)),
      };
    });
}

export function computeWindRose(windData: WindDataPoint[]): WindRoseData {
  const sectorSize = 360 / WIND_DIRECTIONS.length;

  const sectors: WindRoseSector[] = WIND_DIRECTIONS.map((dir, i) => ({
    direction: dir,
    directionDeg: i * sectorSize,
    speedBins: SPEED_BINS.map((bin) => ({ label: bin.label, count: 0, meanPm25: 0 })),
    totalCount: 0,
  }));
  const pm25Sums: number[][] = WIND_DIRECTIONS.map(() => SPEED_BINS.map(() => 0));

  for (const point of windData) {
    const sectorIdx = Math.round(point.windDirection / sectorSize) % WIND_DIRECTIONS.length;
    const binIdx = SPEED_BINS.findIndex((bin) => point.windSpeed >= bin.min && point.windSpeed < bin.max);
    if (binIdx < 0) continue;

    sectors[sectorIdx].speedBins[binIdx].count++;
    sectors[sectorIdx].totalCount++;
    pm25Sums[sectorIdx][binIdx] += point.pm25;
  }

  for (let sector = 0; sector < sectors.length; sector += 1) {
    for (let bin = 0; bin < SPEED_BINS.length; bin += 1) {
      const count = sectors[sector].speedBins[bin].count;
      sectors[sector].speedBins[bin].meanPm25 = count > 0
        ? Number((pm25Sums[sector][bin] / count).toFixed(2))
        : 0;
    }
  }

  return {
    sensorId: "",
    source: "synthetic",
    sourceLabel: SYNTHETIC_WIND_LABEL,
    totalPoints: windData.length,
    sectors,
    speedBinLabels: SPEED_BINS.map((bin) => bin.label),
  };
}

export function computePolarPlot(windData: WindDataPoint[]): PolarPlotData {
  let maxSpeed = 0;
  let maxPm25 = 0;

  const points: Array<[number, number, number]> = windData.map((point) => {
    if (point.windSpeed > maxSpeed) maxSpeed = point.windSpeed;
    if (point.pm25 > maxPm25) maxPm25 = point.pm25;
    return [point.windDirection, point.windSpeed, point.pm25];
  });

  return {
    sensorId: "",
    source: "synthetic",
    sourceLabel: SYNTHETIC_WIND_LABEL,
    points,
    maxSpeed: Number(maxSpeed.toFixed(2)),
    maxPm25: Number(maxPm25.toFixed(2)),
  };
}
