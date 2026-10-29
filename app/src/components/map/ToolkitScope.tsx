import type { CSSProperties, ReactNode } from "react";
import { WorkspaceProvider } from "@pgmaps/geo-toolkit/workspace";

import { useTheme } from "../../hooks/useTheme";
import "./PaMap.css";

/**
 * Toolkit components outside a map (playback bars, legends) take their styles
 * from an enclosing toolkit workspace; this gives them one in PAtool's theme.
 * Keep PAtool's own controls outside it — the toolkit resets borders inside.
 */
export function ToolkitScope({ children, className, style }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { theme } = useTheme();
  return (
    <WorkspaceProvider theme={theme} className={className ? `patool-map ${className}` : "patool-map"} style={style}>
      {children}
    </WorkspaceProvider>
  );
}
