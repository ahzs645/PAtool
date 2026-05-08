/**
 * Register the PAtool service worker for offline-capable static builds.
 *
 * Skips registration in development (Vite's HMR conflicts with cached
 * modules), in tests (jsdom does not implement service workers), and
 * when the page is served over an insecure non-localhost origin where
 * service workers are unavailable.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;

  // Use the same base URL as the app shell so registrations work for both
  // the project-pages "./" base and a root deployment.
  const swUrl = new URL("sw.js", document.baseURI).toString();
  const scope = new URL("./", document.baseURI).pathname;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(swUrl, { scope })
      .catch((error) => {
        // Failure to register is non-fatal — the app still works online.
        console.warn("[patool] service worker registration failed:", error);
      });
  });
}
