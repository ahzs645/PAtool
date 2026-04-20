import { pm25ToAqiBand, type PasRecord } from "@patool/shared";

import { CellStack, Chip, type Column } from "../../components";
import { pm25WindowOptions, type Pm25Window } from "./types";

export function getPm25ForWindow(record: PasRecord, window: Pm25Window): number {
  return record[window] ?? record.pm25Current ?? 0;
}

export function formatPm25(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${value.toFixed(2)} ug/m3`;
}

export function buildColumns(pm25Window: Pm25Window): Column<PasRecord>[] {
  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  return [
    {
      key: "label",
      header: "Sensor",
      width: "40%",
      render: (r: PasRecord) => <CellStack primary={r.label} sub={`#${r.id}`} />,
    },
    {
      key: "state",
      header: "State",
      width: 80,
      render: (r: PasRecord) => r.stateCode ?? "NA",
    },
    {
      key: "pm25",
      header: `PM2.5 (${windowLabel})`,
      width: 120,
      render: (r: PasRecord) => {
        const val = getPm25ForWindow(r, pm25Window);
        const band = pm25ToAqiBand(val);
        const variant = band.label === "Good" ? "success" : band.label === "Moderate" ? "warning" : "danger";
        return <Chip variant={variant}>{val.toFixed(2)}</Chip>;
      },
    },
    {
      key: "mode",
      header: "Mode",
      width: 100,
      render: (r: PasRecord) => <Chip>{r.locationType}</Chip>,
    },
  ];
}
