export type ReferenceDiagram = {
  id: string;
  title: string;
  category: string;
  fileName: string;
  summary: string;
  mermaid: string;
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
    mermaid: `flowchart LR
  subgraph Local["Local System"]
    ETL["ETL, QA/QC,<br/>interpolations, models"] --> ArcPro["ArcPro"]
    ArcPro --> FileGDB["File GDB"]
  end

  subgraph Cloud["Google Cloud"]
    HostedPostGIS["Hosted PostGIS"] --> CloudBuild["Cloud Build"]
    CloudBuild --> CloudRun["Cloud Run"]
    CloudRun --> FlaskAPI["Flask API"]
  end

  FileGDB <-->|"Mirror data goes both ways"| HostedPostGIS
  FlaskAPI --> ArcGISOnline["ArcGIS Online"]`,
  },
  {
    id: "summaries",
    title: "Historic and real-time summaries",
    category: "Summaries",
    fileName: "DFDHistoric_RealTime_Summaries.jpg",
    summary:
      "Sensor ID loading, extreme-value filtering, spike recording, and PM2.5 summary statistics for daily time windows.",
    mermaid: `flowchart TD
  Load["Load sensor IDs and indexes<br/>from xlsx list"]

  subgraph Inputs["Data inputs"]
    direction LR
    Historic["Historic daily summaries<br/>Get historic PurpleAir data"]
    Realtime["Realtime daily summaries<br/>Get realtime PurpleAir data"]
  end

  subgraph Cleanup["QA/QC cleanup"]
    direction TB
    QA(("QA/QC"))
    Timestamp["Timestamp to datetime"]
    Extreme["Remove extreme values<br/>above 1000 PM2.5"]
    NaN["Remove NaN"]
    Cleaned["Cleaned data"]
    QA --> Timestamp
    QA --> Extreme
    QA --> NaN
    Timestamp --> Cleaned
    Extreme --> Cleaned
    NaN --> Cleaned
  end

  subgraph Derived["Derived outputs"]
    direction LR
    StartTimes["Get start times"]
    Spikes["Record spikes above 28<br/>micrograms per cubic meter"]
    Summary["Summary statistics"]
  end

  subgraph SummaryStats["PM2.5 summary windows"]
    direction TB
    Morning["Morning rush<br/>mean, min, max, std"]
    Evening["Evening rush<br/>mean, min, max, std"]
    FullDay["Full day<br/>mean, min, max, std,<br/>minutes above 12 ug"]
    DayAmbient["Daytime ambient<br/>mean, min, max, std"]
    NightAmbient["Nighttime ambient<br/>mean, min, max, std"]
  end

  Load --> Historic
  Load --> Realtime
  Historic --> QA
  Realtime --> QA
  Cleaned --> StartTimes
  Cleaned --> Spikes
  Cleaned --> Summary
  Summary --> Morning
  Summary --> Evening
  Summary --> FullDay
  Summary --> DayAmbient
  Summary --> NightAmbient
  StartTimes --> OneDF["One dataframe"]
  Spikes --> OneDF
  Morning --> OneDF
  Evening --> OneDF
  FullDay --> OneDF
  DayAmbient --> OneDF
  NightAmbient --> OneDF
  OneDF --> Upload["Upload to database"]`,
  },
  {
    id: "qaqc-flow",
    title: "QAQC data flow",
    category: "Quality control",
    fileName: "qaqcDFD.jpg",
    summary:
      "PurpleAir, wind, elevation, emissions, traffic, and zoning preparation before upload into the shared database.",
    mermaid: `flowchart TD
  subgraph Boundary["Extent / boundary"]
    direction TB
    Extent["Download/extract Twin Cities<br/>metro boundary"] --> Buffer8["Create 8 km boundary buffer"]
    Buffer8 --> DB0["Upload boundary"]
  end

  subgraph ElevationLane["Elevation"]
    direction TB
    ElevPrep["Create additional 2 km buffer"]
    ElevMerge["Merge elevation raster tiles"]
    ElevQA(("Elevation QA/QC"))
    ElevChecks["Range, NoData, SRS,<br/>and visual checks"]
    ElevDown["Downsample by 100"]
    ElevProj["Project NAD 1983 to WGS84"]
    ElevPoint["Raster to point"]
    DB1["Upload elevation"]
    ElevPrep --> ElevMerge --> ElevQA --> ElevChecks --> ElevDown --> ElevProj --> ElevPoint --> DB1
  end

  subgraph PurpleAirLane["PurpleAir API"]
    direction TB
    ApiParams["Set rectangular API boundary"] --> ApiCall["Call PurpleAir API"] --> Outdoor["Remove inside sensors"]
  end

  subgraph StationLane["PurpleAir stations"]
    direction TB
    StationQA(("Station QA/QC")) --> StationChecks["Altitude, coordinate,<br/>zero, and NaN checks"] --> DB2["Upload station table"]
  end

  subgraph HistoricLane["PurpleAir historic"]
    direction TB
    Historic["Call historic sensor averages"] --> HistoricQA(("Historic QA/QC"))
    HistoricQA --> HistoricChecks["Humidity, temperature,<br/>pressure, and PM2.5 ranges"] --> DB3["Upload historic table"]
  end

  subgraph RealtimeLane["PurpleAir realtime"]
    direction TB
    Realtime["Call realtime sensor averages"] --> RealtimeQA(("Realtime QA/QC"))
    RealtimeQA --> RealtimeChecks["Range and null checks"] --> DB4["Upload realtime table"]
  end

  subgraph WindLane["Wind"]
    direction TB
    Wind["Download hourly wind data"] --> WindQA(("Wind QA/QC"))
    WindQA --> WindChecks["Speed 0-100 and<br/>direction 0-360 checks"]
    WindChecks --> WindClass["Classify speed and direction"] --> DB5["Upload wind table"]
  end

  subgraph ZoneLane["Zones"]
    direction TB
    Zones["Get zoning data"] --> ZoneQA(("Zoning QA/QC"))
    ZoneQA --> ZoneChecks["Overlapping polygon<br/>and null checks"] --> DB6["Upload zoning table"]
  end

  subgraph AadtLane["AADT"]
    direction TB
    AADT["Download AADT segments"] --> AADTQA(("AADT QA/QC"))
    AADTQA --> AADTChecks["Clip to extent"] --> DB7["Upload traffic table"]
  end

  subgraph EmissionsLane["Emissions"]
    direction TB
    Emissions["Download MPCA emissions"] --> Metro["Select 7-county metro"]
    Metro --> EmissionsQA(("Emissions QA/QC"))
    EmissionsQA --> EmissionsChecks["Coordinate, duplicate,<br/>and discrepancy checks"] --> DB8["Upload emissions table"]
  end

  Buffer8 --> ElevPrep
  ApiCall --> Outdoor
  Outdoor --> StationQA
  Outdoor --> Historic
  Outdoor --> Realtime`,
  },
  {
    id: "qaqc-checks",
    title: "QAQC checks",
    category: "Quality control",
    fileName: "QAQCdiagram.jpg",
    summary:
      "Range checks, geometry checks, null handling, projection checks, and layer-specific error-code generation.",
    mermaid: `flowchart LR
  subgraph ArcPro["ArcPro sources"]
    direction TB
    Source["Call data from source"]
    WindGroup["Historic wind<br/>speed and direction"]
    PurpleAir["PurpleAir current<br/>location, PM2.5, temp, time"]
    DEM["DEM"]
    Zones["Zones"]
    AADT["MNDOT AADT segments"]
    Source --> WindGroup
    Source --> PurpleAir
    Source --> DEM
    Source --> Zones
    Source --> AADT
  end

  subgraph Checks["QA/QC checks"]
    direction TB
    WindQA["Check wind ranges;<br/>classify speed into 4<br/>and direction into 8"]
    PurpleAirQA["Buffer MPLS by 8 km;<br/>remove indoor and nulls;<br/>geometry and altitude checks"]
    DEMQA["Merge and clip rasters;<br/>check SRS, nulls, range;<br/>transform to WGS84"]
    ZoneQA["Find null zone codes,<br/>multipolygons, polygons;<br/>create error-code column"]
    AADTQA["Clip, select columns,<br/>and rename"]
  end

  WindGroup --> WindQA
  PurpleAir --> PurpleAirQA
  DEM --> DEMQA
  Zones --> ZoneQA
  AADT --> AADTQA

  WindQA --> Notebook(("Jupyter Notebook"))
  PurpleAirQA --> Notebook
  DEMQA --> Notebook
  ZoneQA --> Notebook
  AADTQA --> Notebook

  subgraph PostGIS["PostGIS"]
    direction TB
    Create["Create table statements"]
    ArcGDB(("Arc GDB"))
    Database["Database tables"]
  end

  Notebook --> Create
  AADTQA --> ArcGDB
  ArcGDB --> Create
  Create --> Database`,
  },
  {
    id: "interpolation",
    title: "Interpolation workflow",
    category: "Modeling",
    fileName: "interpolationDFD.jpg",
    summary:
      "Elevation, temperature, and PM2.5 interpolation methods with cross-validation and RMSE-based model selection.",
    mermaid: `flowchart TD
  subgraph Prep["Station and historic data prep"]
    direction LR
    Stations["Bring station data<br/>from database"] --> Points["Table to point<br/>for ArcPy tools"]
    Historic["Read historic CSV"] --> TimeFilter["Filter desired<br/>time range"]
    Points --> Join["Join station locations<br/>with historic data"]
    TimeFilter --> Join
  end

  subgraph ElevMethods["Elevation interpolation"]
    direction TB
    Elevation["Bring elevation data<br/>from database"]
    Elevation --> EBK["Empirical Bayesian kriging"]
    Elevation --> IDW["Inverse distance weighted"]
    Elevation --> LocalPoly["Local polynomial"]
  end

  subgraph TempMethods["Temperature interpolation"]
    direction TB
    TempLP["Local polynomial"]
    TempIDW["Inverse distance weighted"]
    TempEBK["Empirical Bayesian kriging"]
  end

  subgraph PmMethods["PM2.5 interpolation"]
    direction TB
    PmLP["Local polynomial"]
    PmIDW["Inverse distance weighted"]
    PmEBK["Empirical Bayesian kriging"]
  end

  subgraph Output["Selection and upload"]
    direction TB
    RasterPoint["Raster to point"]
    Clip["Clip to Minneapolis boundary"]
    CV["Cross validation"]
    RMSE["Calculate RMSE and<br/>select lowest-error method"]
    Upload["Upload selected PM2.5,<br/>temperature, and elevation<br/>interpolations to database"]
    RasterPoint --> Clip --> CV --> RMSE --> Upload
  end

  Join --> TempLP
  Join --> TempIDW
  Join --> TempEBK
  Join --> PmLP
  Join --> PmIDW
  Join --> PmEBK
  EBK --> RasterPoint
  IDW --> RasterPoint
  LocalPoly --> RasterPoint
  TempLP --> RasterPoint
  TempIDW --> RasterPoint
  TempEBK --> RasterPoint
  PmLP --> RasterPoint
  PmIDW --> RasterPoint
  PmEBK --> RasterPoint`,
  },
  {
    id: "modeling",
    title: "Exposure modeling workflow",
    category: "Modeling",
    fileName: "Modeling.jpg",
    summary:
      "Historic PurpleAir, weather, traffic, and facility inputs feeding Huff, IDW, and geographically weighted regression models.",
    mermaid: `flowchart LR
  subgraph Param["1_parameter_df"]
    direction TB
    A0["Bring in spike and<br/>historic PurpleAir data"]
    A1["Select timestamp, sensor index,<br/>humidity, temp, pressure, PM2.5"]
    A2["Get sensor locations"]
    A3["Get inverse-weighted sums<br/>for MPCA facilities and traffic"]
    A4["Export Parameter_df.csv"]
    A0 --> A1 --> A2 --> A3 --> A4
  end

  subgraph Gravity["GravityModel"]
    direction TB
    G0["Bring station locations,<br/>wind data, and spike data"]
    G1["Average wind speed<br/>and direction by day"]
    G2["Normalize wind speed<br/>and direction"]
    G3["Determine population or<br/>total spikes per station"]
    G4["Find station distances<br/>and delete duplicates"]
    G5["Select day and 2-hour<br/>spike window"]
    G6["Run Huff model with<br/>varying alphas and betas"]
    G7["Run accuracy assessment"]
    G8["Determine best simulation"]
    G9["Sum predicted spike<br/>instances by sensor index"]
    G0 --> G1 --> G2 --> G3 --> G4 --> G5 --> G6 --> G7 --> G8 --> G9
  end

  subgraph GravityOutput["Gravity output"]
    direction TB
    Observed["Sum observed spike<br/>instances by sensor index"]
    Predicted["Sum predicted spike<br/>instances by sensor index"]
    DB["Upload to database"]
    Observed --> DB
    Predicted --> DB
  end

  G5 --> Observed
  G9 --> Predicted

  subgraph GWR["GWR_Best_models"]
    direction TB
    W0["Bring in historic<br/>PurpleAir data"]
    W1["Get previous day's data"]
    W2["Remove NaNs"]
    W3["Merge historical data<br/>with sensor locations"]
    W4["Map dates to sensors"]
    W5["Define independent variables"]
    W6["Find variable combinations"]
    W7["Project data by sensor"]
    W8["Run geographically<br/>weighted regression"]
    W9["Store results"]
    W10["Compare all results<br/>for season bests"]
    W11["Review best models"]
    W0 --> W1 --> W2 --> W3 --> W4 --> W5 --> W6 --> W7 --> W8 --> W9 --> W10 --> W11
  end

  subgraph Prediction["Prediction"]
    direction TB
    P0["IDW sums from sensors<br/>to traffic and facilities"]
    P1["Summarize yesterday's<br/>10-minute PurpleAir averages"]
    P2["Get weather forecast"]
    P3["Merge on sensor index"]
    P4["Load models as GeoJSON"]
    P5["Merge models with<br/>parameter_df by sensor index"]
    P6["Sum betas multiplied<br/>by independent variables"]
    P7["Save prediction CSV"]
    P8["Upload to database"]
    P0 --> P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8
  end`,
  },
];
