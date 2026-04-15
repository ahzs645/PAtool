import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";

import { Shell, Loader } from "./components";
import { routerMode } from "./lib/routing";

const queryClient = new QueryClient();
const ExplorerPage = lazy(() => import("./pages/ExplorerPage"));
const SensorDetailPage = lazy(() => import("./pages/SensorDetailPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const ComparisonPage = lazy(() => import("./pages/ComparisonPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));
const HealthPage = lazy(() => import("./pages/HealthPage"));

function RoutesView() {
  const Router = routerMode === "hash" ? HashRouter : BrowserRouter;

  return (
    <Router>
      <Shell>
        <Suspense fallback={<Loader message="Loading page..." />}>
          <Routes>
            <Route path="/" element={<ExplorerPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/sensor/:id" element={<SensorDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/comparison" element={<ComparisonPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="/diagnostics/:id" element={<DiagnosticsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/health/:id" element={<HealthPage />} />
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
