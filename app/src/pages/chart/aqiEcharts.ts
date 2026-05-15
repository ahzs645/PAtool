import {
  aqiBreakpointsWithPalette,
  aqiThresholds,
  EPA_PM25_AQI_PROFILE,
  pm25ToAqiBandWithPalette,
} from "@patool/shared";

export function buildAqiMarkLines(textColor: string) {
  return {
    silent: true,
    symbol: "none",
    label: {
      color: textColor,
      formatter: "{b}",
      position: "insideEndTop",
    },
    lineStyle: { type: "dashed", width: 1, opacity: 0.45 },
    data: aqiThresholds(EPA_PM25_AQI_PROFILE).map((value) => ({
      name: `${value} ug/m3`,
      yAxis: value,
    })),
  };
}

export function buildAqiMarkAreas() {
  const bands = aqiBreakpointsWithPalette(EPA_PM25_AQI_PROFILE, "subdued");
  return {
    silent: true,
    itemStyle: { opacity: 0.08 },
    data: bands.map((band) => [
      {
        yAxis: band.concLow,
        itemStyle: { color: band.color },
      },
      { yAxis: band.concHigh },
    ]),
  };
}

export function colorDailyPm25Bar(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return { value: null };
  const band = pm25ToAqiBandWithPalette(value, EPA_PM25_AQI_PROFILE, "subdued");
  return {
    value,
    itemStyle: { color: band.color },
  };
}
