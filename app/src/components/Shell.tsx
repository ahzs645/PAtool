import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { DataStatus } from "@patool/shared";
import { useTheme } from "../hooks/useTheme";
import { getJson } from "../lib/api";
import styles from "./Shell.module.css";

const navItems = [
  { to: "/", label: "Explorer", icon: TableIcon },
  { to: "/map", label: "Map", icon: MapIcon },
  { to: "/airfuse", label: "AirFuse", icon: AirFuseIcon },
  { to: "/campaigns", label: "Campaigns", icon: RouteIcon },
  { to: "/sentinel", label: "SENTINEL", icon: ImportIcon },
  { to: "/analytics", label: "Analytics", icon: ChartIcon },
  { to: "/network-summary", label: "Network", icon: NetworkIcon },
  { to: "/modeling", label: "Modeling", icon: LayersIcon },
  { to: "/model-zoo", label: "Model Zoo", icon: ModelZooIcon },
  { to: "/validation-lab", label: "Validation", icon: ValidationIcon },
  { to: "/measurement-error", label: "Measurement Error", icon: ErrorIcon },
  { to: "/regimes", label: "Regimes", icon: RegimeIcon },
  { to: "/covariates", label: "Covariates", icon: DatabaseIcon },
  { to: "/reliability", label: "Reliability", icon: ShieldIcon },
  { to: "/comparison", label: "Comparison", icon: CompareIcon },
  { to: "/diagnostics", label: "Diagnostics", icon: DiagnosticsIcon },
  { to: "/health", label: "Health", icon: HealthIcon },
  { to: "/poi", label: "Schools / POIs", icon: PinIcon },
  { to: "/ej-coverage", label: "EJ Coverage", icon: ScaleIcon },
  { to: "/forecast", label: "Forecast", icon: ForecastIcon },
  { to: "/weather-normalization", label: "Weather Norm", icon: WeatherNormIcon },
  { to: "/human-impact", label: "Human Impact", icon: HumanImpactIcon },
  { to: "/data-readiness", label: "Data Readiness", icon: DataReadinessIcon },
  { to: "/outcome-model", label: "Outcome model", icon: SigmaIcon },
  { to: "/reports", label: "Reports", icon: ReportIcon },
];

function ScaleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M5 21h14" />
      <path d="M5 8l-3 6h6z" />
      <path d="M19 8l-3 6h6z" />
      <path d="M5 8h14" />
    </svg>
  );
}

function ForecastIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l4-6 4 4 5-7 5 9" />
      <path d="M3 21h18" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M8.5 16.5c4-2 3-7 7-8.5" />
      <path d="M9 18h6" />
    </svg>
  );
}

function WeatherNormIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17c3-5 7-6 12-4 2 .8 3.5.6 5-.8" />
      <path d="M4 21h16" />
      <path d="M7 7a5 5 0 0 1 9.6-1.8A3.5 3.5 0 1 1 18 12H7a2.5 2.5 0 0 1 0-5z" />
    </svg>
  );
}

function HumanImpactIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
      <path d="M3 13h4l2-4 3 8 2-4h7" />
    </svg>
  );
}

function DataReadinessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M8 17V9" />
      <path d="M12 17V7" />
      <path d="M16 17v-5" />
      <path d="M20 17V6" />
      <path d="M3 19h18" />
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const { data: status } = useQuery({
    queryKey: ["api-status"],
    queryFn: () => getJson<DataStatus>("/api/status"),
    staleTime: 60_000,
  });
  const warning = status?.warnings?.[0];

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#patool-main">
        Skip to main content
      </a>
      <aside className={styles.sidebar} aria-label="Primary navigation">
        <Link className={styles.brand} to="/">
          <span className={styles.brandIcon} aria-hidden="true">A</span>
          <span className={styles.brandName}>PAtool</span>
        </Link>

        <span className={styles.navLabel} id="workspace-nav-label">Workspace</span>
        <nav className={styles.navSection} aria-labelledby="workspace-nav-label">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.active : ""}`
              }
            >
              <span className={styles.navIcon} aria-hidden="true">
                <item.icon />
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.themeToggle}
            onClick={toggle}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            <span className={styles.navIcon} aria-hidden="true">
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
            </span>
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </aside>

      <main className={styles.main} id="patool-main" tabIndex={-1}>
        {warning && (
          <div className={styles.statusBanner} role="status" aria-live="polite">
            <span className={styles.statusDot} aria-hidden="true" />
            <span>{warning}</span>
            <span className={styles.statusSource}>{status.collectionSource}</span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/* ── Icons ── */

function MapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function AirFuseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15c3-6 8-8 16-7" />
      <path d="M4 19c4-3 8-4 14-3" />
      <circle cx="7" cy="8" r="2" />
      <circle cx="15" cy="5" r="2" />
      <path d="M9 8h4" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M5 5h4" />
      <path d="M15 5h4" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function NetworkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="7" r="3" />
      <circle cx="18" cy="7" r="3" />
      <circle cx="12" cy="17" r="3" />
      <path d="M8.5 9.2l2 4.3" />
      <path d="M15.5 9.2l-2 4.3" />
      <path d="M9 7h6" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M11 18H8a2 2 0 0 1-2-2V9" />
    </svg>
  );
}

function ModelZooIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h18" />
      <path d="M6 7v13" />
      <path d="M18 7v13" />
      <path d="M9 7v13" />
      <path d="M15 7v13" />
      <path d="M5 4h14" />
      <circle cx="6" cy="20" r="1" />
      <circle cx="12" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </svg>
  );
}

function ValidationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
      <path d="M14 4h6v6" />
      <path d="M4 20h16" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M7 15l4-5 4 3 5-7" />
      <path d="M7 8h4" />
      <path d="M9 6v4" />
    </svg>
  );
}

function RegimeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 18c3-7 7-10 16-11" />
      <path d="M4 12c4 2 8 2 12-1" />
      <path d="M5 5c2 3 5 4 9 4" />
      <circle cx="18" cy="7" r="2" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function DiagnosticsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="11" y1="8" x2="11" y2="14" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function SigmaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 4 6 4 12 12 6 20 18 20" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
      <path d="M8 9h2" />
    </svg>
  );
}
