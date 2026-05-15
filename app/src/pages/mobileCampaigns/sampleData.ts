import type { ReferenceMonitor, ReferenceObservation } from "@patool/shared";

export const SAMPLE_AIRBEAM_CSV = `Session_Name,Timestamp,Latitude,Longitude,PM2.5,Humidity,Temperature
Downtown loop,2024-06-01T08:00:00Z,49.2800,-123.1200,7.5,42,18
Downtown loop,2024-06-01T08:01:00Z,49.2804,-123.1207,9.4,42,18
Downtown loop,2024-06-01T08:02:00Z,49.2809,-123.1214,13.1,43,18
Downtown loop,2024-06-01T08:03:00Z,49.2814,-123.1220,22.8,43,19
Downtown loop,2024-06-01T08:04:00Z,49.2820,-123.1227,18.6,44,19
Downtown loop,2024-06-01T08:05:00Z,49.2826,-123.1234,12.2,44,19
School transect,2024-06-02T15:00:00Z,49.2630,-123.1070,10.2,45,21
School transect,2024-06-02T15:01:00Z,49.2635,-123.1077,15.8,46,21
School transect,2024-06-02T15:02:00Z,49.2640,-123.1084,28.4,47,21
School transect,2024-06-02T15:03:00Z,49.2647,-123.1091,33.5,47,21
School transect,2024-06-02T15:04:00Z,49.2654,-123.1098,24.1,48,20
School transect,2024-06-02T15:05:00Z,49.2660,-123.1105,16.7,48,20
Port edge,2024-06-03T18:00:00Z,49.2890,-123.1030,14.1,50,19
Port edge,2024-06-03T18:01:00Z,49.2896,-123.1038,21.9,50,19
Port edge,2024-06-03T18:02:00Z,49.2902,-123.1046,39.6,51,18
Port edge,2024-06-03T18:03:00Z,49.2908,-123.1054,44.2,51,18
Port edge,2024-06-03T18:04:00Z,49.2914,-123.1062,31.5,52,18
Port edge,2024-06-03T18:05:00Z,49.2920,-123.1070,20.3,52,18`;

export const SAMPLE_REFERENCE_MONITORS: ReferenceMonitor[] = [
  { id: "ref-downtown", name: "Downtown reference", latitude: 49.282, longitude: -123.12, source: "OpenAQ", pm25: 11.8 },
  { id: "ref-school", name: "School reference", latitude: 49.265, longitude: -123.109, source: "OpenAQ", pm25: 18.2 },
  { id: "ref-port", name: "Port reference", latitude: 49.291, longitude: -123.104, source: "OpenAQ", pm25: 24.4 },
  { id: "ref-regional", name: "Regional background", latitude: 49.23, longitude: -123.02, source: "AQS", pm25: 8.6 },
];

export const SAMPLE_REFERENCE_OBSERVATIONS: ReferenceObservation[] = [
  { timestamp: "2024-06-01T08:00:00Z", pm25: 10.5, monitorId: "ref-downtown" },
  { timestamp: "2024-06-02T15:00:00Z", pm25: 18.8, monitorId: "ref-school" },
  { timestamp: "2024-06-03T18:00:00Z", pm25: 28.2, monitorId: "ref-port" },
];
