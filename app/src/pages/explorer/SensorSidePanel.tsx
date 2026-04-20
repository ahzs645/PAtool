import { pm25ToAqiBand, type EnhancedSohIndexResult, type OutlierResult, type PasRecord, type PatSeries } from "@patool/shared";
import type { Dispatch, MouseEvent, SetStateAction } from "react";

import { Button } from "../../components";
import { IconClose, IconHeart, IconHome, IconSearch, IconTimeseries } from "./icons";
import {
  SidePanelDiagnosticsTab,
  SidePanelHealthTab,
  SidePanelHomeTab,
  SidePanelTimeseriesTab,
} from "./sidePanelTabs";
import type { SidePanelTab } from "./types";
import styles from "../ExplorerPage.module.css";

type SensorSidePanelProps = {
  panelOpen: boolean;
  isResizing: boolean;
  panelWidth: number;
  onResizeMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  displayedSensor: PasRecord | null;
  activeTab: SidePanelTab;
  setActiveTab: Dispatch<SetStateAction<SidePanelTab>>;
  patData: PatSeries | undefined;
  patLoading: boolean;
  sohData: EnhancedSohIndexResult | undefined;
  sohLoading: boolean;
  outlierData: OutlierResult | undefined;
  outlierLoading: boolean;
  onClose: () => void;
  onOpenDiagnostics: (sensorId: string) => void;
  onOpenSensor: (sensorId: string) => void;
};

export function SensorSidePanel({
  panelOpen,
  isResizing,
  panelWidth,
  onResizeMouseDown,
  displayedSensor,
  activeTab,
  setActiveTab,
  patData,
  patLoading,
  sohData,
  sohLoading,
  outlierData,
  outlierLoading,
  onClose,
  onOpenDiagnostics,
  onOpenSensor,
}: SensorSidePanelProps) {
  const sensorBand = displayedSensor ? pm25ToAqiBand(displayedSensor.pm25Current) : null;

  return (
    <>
      {panelOpen && (
        <div
          className={`${styles.resizeHandle} ${isResizing ? styles.resizeHandleActive : ""}`}
          onMouseDown={onResizeMouseDown}
        />
      )}

      <div
        className={`${styles.sidePanelWrapper} ${panelOpen ? styles.sidePanelWrapperOpen : styles.sidePanelWrapperClosed}`}
        style={panelOpen ? {
          width: panelWidth,
          transition: isResizing ? "none" : undefined,
        } : undefined}
      >
        {displayedSensor && sensorBand && (
          <aside className={styles.sidePanel} style={{ width: panelWidth }}>
            <div className={styles.sidePanelCloseRow}>
              <button
                type="button"
                className={styles.sidePanelClose}
                onClick={onClose}
                aria-label="Close detail panel"
              >
                <IconClose />
              </button>
            </div>

            <div className={styles.sidePanelHeader}>
              <div
                className={styles.sidePanelIcon}
                style={{ background: sensorBand.color }}
                title={sensorBand.label}
              >
                A
              </div>
              <div className={styles.sidePanelHeaderInfo}>
                <div className={styles.sidePanelTitle}>{displayedSensor.label}</div>
                <div className={styles.sidePanelSubtitle}>
                  #{displayedSensor.id} &middot; Created by PurpleAir
                </div>
              </div>
            </div>

            <div className={styles.tabBar}>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === "home" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("home")}
              >
                <IconHome /> Home
              </button>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === "timeseries" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("timeseries")}
              >
                <IconTimeseries /> Timeseries
              </button>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === "health" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("health")}
              >
                <IconHeart /> Health
              </button>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === "diagnostics" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("diagnostics")}
              >
                <IconSearch /> Diagnostics
              </button>
            </div>

            <div className={styles.sidePanelBody}>
              {activeTab === "home" && (
                <SidePanelHomeTab sensor={displayedSensor} />
              )}
              {activeTab === "timeseries" && (
                <SidePanelTimeseriesTab sensor={displayedSensor} patData={patData} isLoading={patLoading} />
              )}
              {activeTab === "health" && (
                <SidePanelHealthTab sohData={sohData} isLoading={patLoading || sohLoading} />
              )}
              {activeTab === "diagnostics" && (
                <SidePanelDiagnosticsTab outlierData={outlierData} patData={patData} isLoading={patLoading || outlierLoading} />
              )}
            </div>

            <div className={styles.sidePanelFooter}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => onOpenDiagnostics(displayedSensor.id)}
              >
                Options
              </Button>
              <Button
                variant="accent"
                size="small"
                onClick={() => onOpenSensor(displayedSensor.id)}
              >
                Open{" "}
                <span className={styles.kbdHint}>
                  <kbd className={styles.kbd}>&#8984;</kbd>
                  <kbd className={styles.kbd}>&#9166;</kbd>
                </span>
              </Button>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
