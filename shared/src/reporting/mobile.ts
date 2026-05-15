import {
  buildMobileCalendar,
  buildRouteSegments,
  summarizeDistribution,
  summarizeMobileCampaign,
  type DistributionSummary,
  type MobileCalendarCell,
  type MobileCampaignSummary,
  type MobileSensingPoint,
  type ReferenceMonitorMatch,
  type RouteSegmentSummary,
} from "../mobileSensing";

export type MobileCampaignReportSummary = {
  campaign: MobileCampaignSummary;
  distribution: DistributionSummary;
  calendar: MobileCalendarCell[];
  routeSegments: RouteSegmentSummary[];
  nearestReference: ReferenceMonitorMatch | null;
  figurePlan: Array<{
    id: "mobile-route-map" | "mobile-reference-comparison" | "mobile-calendar" | "mobile-distribution" | "mobile-segments";
    label: string;
    required: boolean;
  }>;
};

export function buildMobileCampaignReportSummary(
  points: ReadonlyArray<MobileSensingPoint>,
  options: { nearestReference?: ReferenceMonitorMatch | null; segmentDistanceKm?: number } = {},
): MobileCampaignReportSummary {
  return {
    campaign: summarizeMobileCampaign(points),
    distribution: summarizeDistribution(points.map((point) => point.pm25)),
    calendar: buildMobileCalendar(points),
    routeSegments: buildRouteSegments(points, { targetDistanceKm: options.segmentDistanceKm ?? 0.25 }),
    nearestReference: options.nearestReference ?? null,
    figurePlan: [
      { id: "mobile-route-map", label: "Mobile route map", required: true },
      { id: "mobile-reference-comparison", label: "Mobile sensor vs nearest reference", required: true },
      { id: "mobile-calendar", label: "Daily mobile PM2.5 calendar", required: false },
      { id: "mobile-distribution", label: "Mobile PM2.5 distribution", required: false },
      { id: "mobile-segments", label: "Route segment ranking", required: false },
    ],
  };
}
