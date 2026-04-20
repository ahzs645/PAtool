export type Pm25Window =
  | "pm25Current"
  | "pm25_10min"
  | "pm25_30min"
  | "pm25_1hr"
  | "pm25_6hr"
  | "pm25_1day"
  | "pm25_1week";

export const pm25WindowOptions: { value: Pm25Window; label: string }[] = [
  { value: "pm25Current", label: "Current" },
  { value: "pm25_10min", label: "10min" },
  { value: "pm25_30min", label: "30min" },
  { value: "pm25_1hr", label: "1hr" },
  { value: "pm25_6hr", label: "6hr" },
  { value: "pm25_1day", label: "1day" },
  { value: "pm25_1week", label: "1week" },
];

export type SidePanelTab = "home" | "timeseries" | "health" | "diagnostics";
