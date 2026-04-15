import { useTheme } from "./useTheme";

const light = {
  colors: ["#4754b8", "#2e9e8f", "#e06c5e", "#e5953e", "#6e7ac8"],
  axis: "#999999",
  grid: "#ebebeb",
  text: "#666666",
  bg: "#ffffff",
  tooltipBg: "#ffffff",
  tooltipBorder: "#ebebeb",
  tooltipText: "#333333",
};

const dark = {
  colors: ["#8b95d6", "#4ec9b0", "#f07070", "#f0b060", "#abb2e4"],
  axis: "#818181",
  grid: "#2a2a2a",
  text: "#b3b3b3",
  bg: "#171717",
  tooltipBg: "#1b1b1b",
  tooltipBorder: "#222222",
  tooltipText: "#ebebeb",
};

export function useChartTheme() {
  const { theme } = useTheme();
  return theme === "dark" ? dark : light;
}
