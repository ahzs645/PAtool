export type ReferenceDiagram = {
  id: string;
  title: string;
  category: string;
  fileName: string;
  summary: string;
};

export const REFERENCE_DIAGRAM_SOURCE = {
  label: "Final_Draft.pdf / Final_Draft.tex",
  attribution:
    "Source: Final_Draft.pdf and Final_Draft.tex, imported UMN Quality Air Quality Cities workflow reference material.",
  localPaths: [
    "/Users/ahmadjalil/Downloads/Final_Draft.pdf",
    "/Users/ahmadjalil/Downloads/Final_Draft.tex",
  ],
} as const;

export const REFERENCE_DIAGRAMS: ReferenceDiagram[] = [
  {
    id: "architecture",
    title: "High-level architecture",
    category: "System",
    fileName: "highlevelArchitecture.jpg",
    summary:
      "Local GIS tooling, cloud database services, API access, and ArcGIS Online publishing for the project workflow.",
  },
  {
    id: "summaries",
    title: "Historic and real-time summaries",
    category: "Summaries",
    fileName: "DFDHistoric_RealTime_Summaries.jpg",
    summary:
      "Sensor ID loading, extreme-value filtering, spike recording, and PM2.5 summary statistics for daily time windows.",
  },
  {
    id: "qaqc-flow",
    title: "QAQC data flow",
    category: "Quality control",
    fileName: "qaqcDFD.jpg",
    summary:
      "PurpleAir, wind, elevation, emissions, traffic, and zoning preparation before upload into the shared database.",
  },
  {
    id: "qaqc-checks",
    title: "QAQC checks",
    category: "Quality control",
    fileName: "QAQCdiagram.jpg",
    summary:
      "Range checks, geometry checks, null handling, projection checks, and layer-specific error-code generation.",
  },
  {
    id: "interpolation",
    title: "Interpolation workflow",
    category: "Modeling",
    fileName: "interpolationDFD.jpg",
    summary:
      "Elevation, temperature, and PM2.5 interpolation methods with cross-validation and RMSE-based model selection.",
  },
  {
    id: "modeling",
    title: "Exposure modeling workflow",
    category: "Modeling",
    fileName: "Modeling.jpg",
    summary:
      "Historic PurpleAir, weather, traffic, and facility inputs feeding Huff, IDW, and geographically weighted regression models.",
  },
];
