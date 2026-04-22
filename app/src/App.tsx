import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";

import { Shell, Loader } from "./components";
import { routerMode } from "./lib/routing";

const queryClient = new QueryClient();
const ExplorerPage = lazy(() => import("./pages/ExplorerPage"));
const SensorDetailPage = lazy(() => import("./pages/SensorDetailPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const ModelingPage = lazy(() => import("./pages/ModelingPage"));
const ComparisonPage = lazy(() => import("./pages/ComparisonPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));
const HealthPage = lazy(() => import("./pages/HealthPage"));
const AirFusePage = lazy(() => import("./pages/AirFusePage"));
const PoiExposurePage = lazy(() => import("./pages/PoiExposurePage"));
const OutcomeModelPage = lazy(() => import("./pages/OutcomeModelPage"));

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
            <Route path="/sensor/:id" element={<SensorDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/modeling" element={<ModelingPage />} />
            <Route path="/comparison" element={<ComparisonPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="/diagnostics/:id" element={<DiagnosticsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/health/:id" element={<HealthPage />} />
            <Route path="/poi" element={<PoiExposurePage />} />
            <Route path="/outcome-model" element={<OutcomeModelPage />} />
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
