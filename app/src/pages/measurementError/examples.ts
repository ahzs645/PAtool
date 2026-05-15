export type ExampleDataset = {
  id: string;
  label: string;
  pollutant: string;
  units: string;
  path: string;
  reference: string;
  sensor: string;
  dqObjective?: number;
  limitValue?: number;
  corrected?: {
    path: string;
    reference: string;
    sensor: string;
  };
};

export const MEASUREMENT_ERROR_EXAMPLES: ExampleDataset[] = [
  {
    id: "no2-lcs",
    label: "NO2 low-cost sensor",
    pollutant: "NO2",
    units: "ppb",
    path: "/examples/measurement-errors/Fig5.csv",
    reference: "NO2",
    sensor: "LCS1",
    dqObjective: 25,
  },
  {
    id: "o3-lcs",
    label: "O3 low-cost sensor",
    pollutant: "O3",
    units: "ppb",
    path: "/examples/measurement-errors/Fig5.csv",
    reference: "O3",
    sensor: "LCS2",
    dqObjective: 30,
  },
  {
    id: "pm25-transfer",
    label: "PM2.5 transfer correction",
    pollutant: "PM2.5",
    units: "ug/m3",
    path: "/examples/measurement-errors/Fig6b.csv",
    reference: "PM2.5_Fidas200",
    sensor: "LCS3",
    dqObjective: 50,
    corrected: {
      path: "/examples/measurement-errors/FigS2_b.csv",
      reference: "PM2.5_Fidas200",
      sensor: "LCS3*",
    },
  },
  {
    id: "no2-reference",
    label: "NO2 reference-vs-reference",
    pollutant: "NO2",
    units: "ppb",
    path: "/examples/measurement-errors/Fig7_panel_b.csv",
    reference: "NO2_T500",
    sensor: "T200U(b)",
    dqObjective: 15,
  },
  {
    id: "o3-reference",
    label: "O3 reference-vs-reference",
    pollutant: "O3",
    units: "ppb",
    path: "/examples/measurement-errors/FigS3_panel_b.csv",
    reference: "O3_49i",
    sensor: "2B",
    dqObjective: 15,
  },
];
