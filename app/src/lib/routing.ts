export const routerMode = import.meta.env.VITE_ROUTER_MODE ?? (import.meta.env.PROD ? "hash" : "browser");

export function appPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return routerMode === "hash" ? `#${normalized}` : normalized;
}
