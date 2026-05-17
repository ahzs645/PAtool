import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";

import { Shell, Loader } from "./components";
import { routerMode } from "./lib/routing";

const queryClient = new QueryClient();
const ExplorerPage = lazy(() => import("./pages/ExplorerPage"));
const SensorDetailPage = lazy(() => import("./pages/SensorDetailPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const NetworkSummaryPage = lazy(() => import("./pages/NetworkSummaryPage"));
const ModelingPage = lazy(() => import("./pages/ModelingPage"));
const ModelZooPage = lazy(() => import("./pages/ModelZooPage"));
const ValidationLabPage = lazy(() => import("./pages/ValidationLabPage"));
const MeasurementErrorPage = lazy(() => import("./pages/MeasurementErrorPage"));
const EpaEvaluationPage = lazy(() => import("./pages/EpaEvaluationPage"));
const DirectionalAnalysisPage = lazy(() => import("./pages/DirectionalAnalysisPage"));
const NetworkQaPage = lazy(() => import("./pages/NetworkQaPage"));
const RegimeWorkbenchPage = lazy(() => import("./pages/RegimeWorkbenchPage"));
const CovariateLayersPage = lazy(() => import("./pages/CovariateLayersPage"));
const ReliabilityReportsPage = lazy(() => import("./pages/ReliabilityReportsPage"));
const ComparisonPage = lazy(() => import("./pages/ComparisonPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));
const HealthPage = lazy(() => import("./pages/HealthPage"));
const AirFusePage = lazy(() => import("./pages/AirFusePage"));
const MobileCampaignsPage = lazy(() => import("./pages/MobileCampaignsPage"));
const SentinelLabPage = lazy(() => import("./pages/SentinelLabPage"));
const PoiExposurePage = lazy(() => import("./pages/PoiExposurePage"));
const OutcomeModelPage = lazy(() => import("./pages/OutcomeModelPage"));
const ReportBuilderPage = lazy(() => import("./pages/ReportBuilderPage"));
const EjCoveragePage = lazy(() => import("./pages/EjCoveragePage"));
const ForecastPage = lazy(() => import("./pages/ForecastPage"));
const WeatherNormalizationPage = lazy(() => import("./pages/WeatherNormalizationPage"));
const HumanImpactPage = lazy(() => import("./pages/HumanImpactPage"));
const DataReadinessPage = lazy(() => import("./pages/DataReadinessPage"));

function RoutesView() {
  const Router = routerMode === "hash" ? HashRouter : BrowserRouter;

  return (
    <Router>
      <Shell>
        <Suspense fallback={<Loader message="Loading page..." />}>
          <Routes>
            <Route path="/" element={<ExplorerPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/airfuse" element={<AirFusePage />} />
            <Route path="/campaigns" element={<MobileCampaignsPage />} />
            <Route path="/sentinel" element={<SentinelLabPage />} />
            <Route path="/sensor/:id" element={<SensorDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/network-summary" element={<NetworkSummaryPage />} />
            <Route path="/modeling" element={<ModelingPage />} />
            <Route path="/model-zoo" element={<ModelZooPage />} />
            <Route path="/validation-lab" element={<ValidationLabPage />} />
            <Route path="/measurement-error" element={<MeasurementErrorPage />} />
            <Route path="/epa-evaluation" element={<EpaEvaluationPage />} />
            <Route path="/directional-analysis" element={<DirectionalAnalysisPage />} />
            <Route path="/network-qa" element={<NetworkQaPage />} />
            <Route path="/regimes" element={<RegimeWorkbenchPage />} />
            <Route path="/covariates" element={<CovariateLayersPage />} />
            <Route path="/reliability" element={<ReliabilityReportsPage />} />
            <Route path="/comparison" element={<ComparisonPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="/diagnostics/:id" element={<DiagnosticsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/health/:id" element={<HealthPage />} />
            <Route path="/poi" element={<PoiExposurePage />} />
            <Route path="/outcome-model" element={<OutcomeModelPage />} />
            <Route path="/reports" element={<ReportBuilderPage />} />
            <Route path="/ej-coverage" element={<EjCoveragePage />} />
            <Route path="/forecast" element={<ForecastPage />} />
            <Route path="/weather-normalization" element={<WeatherNormalizationPage />} />
            <Route path="/human-impact" element={<HumanImpactPage />} />
            <Route path="/data-readiness" element={<DataReadinessPage />} />
          </Routes>
        </Suspense>
      </Shell>
    </Router>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RoutesView />
    </QueryClientProvider>
  );
}
