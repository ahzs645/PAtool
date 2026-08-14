/**
 * Responsive layout smoke check.
 *
 * Walks every route at phone, tablet, and desktop widths and fails on the two
 * things that make a page unusable on a real device: a document that scrolls
 * sideways, and a route that renders nothing. Inner panes (data tables, code
 * blocks, chart strips) are allowed to scroll horizontally on their own — only
 * overflow that escapes to the document counts.
 *
 * Usage: npm run test:responsive
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const SERVER_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_800;

const ROUTES = [
  "/", "/map", "/timelapse", "/network-summary",
  "/import", "/loaders", "/sentinel", "/campaigns", "/covariates",
  "/flagging", "/corrections", "/channel-fit", "/temp-calibration", "/diagnostics", "/data-readiness",
  "/epa-evaluation", "/comparison", "/validation-lab", "/network-qa", "/reliability", "/sensor-evaluation",
  "/measurement-error", "/reu-decomposition",
  "/modeling", "/model-zoo", "/forecast", "/nowcast", "/regimes", "/weather-normalization",
  "/rmweather-counterfactual",
  "/analytics", "/directional-analysis", "/openair-panels", "/trajectories", "/bitesized-extensions",
  "/health", "/human-impact", "/poi", "/ej-coverage", "/outcome-model",
  "/reports", "/airfuse", "/equations",
];

const VIEWPORTS = [
  { name: "phone", width: 360, height: 740, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: false },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => server.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

async function findAppPort() {
  const requested = Number(process.env.PATOOL_APP_PORT ?? 5183);
  for (let port = requested; port < requested + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available app port found starting at ${requested}`);
}

function startAppServer(port, recentOutput) {
  const child = spawn(
    "npm",
    ["run", "dev", "--workspace", "app", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: process.cwd(),
      // The static adapter serves fixtures from the browser, so this check does
      // not need the Worker running alongside it.
      env: { ...process.env, VITE_DATA_SOURCE: "static", BROWSER: "none", NO_UPDATE_NOTIFIER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own the process group: `npm run` forks Vite, and signalling only npm
      // leaves Vite alive holding this process's stdio pipes open, so the
      // check never exits.
      detached: true,
    },
  );

  const remember = (chunk) => {
    recentOutput.push(chunk.toString());
    while (recentOutput.length > 80) recentOutput.shift();
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  return child;
}

async function waitForServer(url, child) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < SERVER_TIMEOUT_MS) {
    if (child.exitCode != null) throw new Error(`Dev server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

async function stopAppServer(child) {
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* group already gone */
    }
  };

  if (child.exitCode == null) {
    signalGroup("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3_000)]);
    if (child.exitCode == null) signalGroup("SIGKILL");
  }

  // Vite can outlive the signal briefly; dropping the pipes lets Node exit.
  child.stdout?.destroy();
  child.stderr?.destroy();
}

function probeLayout() {
  const docWidth = document.documentElement.clientWidth;
  const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const offenders = [];

  if (scrollWidth > docWidth + 1) {
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right <= docWidth + 1 && rect.left >= -1) continue;
      // The closed nav drawer parks off the left edge; it is not an offender.
      if (getComputedStyle(element).visibility === "hidden") continue;

      // An ancestor that scrolls or clips on the x-axis means this element was
      // meant to overflow inside its own pane, not out to the document.
      let clipped = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowX)) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;

      offenders.push({
        tag: element.tagName.toLowerCase(),
        cls: typeof element.className === "string" ? element.className.slice(0, 70) : "",
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (element.textContent ?? "").trim().slice(0, 40),
      });
    }
    offenders.sort((a, b) => b.right - a.right);
  }

  const main = document.getElementById("patool-main");
  return {
    docWidth,
    scrollWidth,
    mainScrollsSideways: Boolean(main && main.scrollWidth > main.clientWidth + 1),
    rendered: (main?.textContent ?? "").trim().length > 40,
    offenders: offenders.slice(0, 5),
  };
}

async function main() {
  const port = await findAppPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const recentOutput = [];
  const server = startAppServer(port, recentOutput);
  const failures = [];
  let browser;

  try {
    await waitForServer(baseUrl, server);
    browser = await chromium.launch({
      headless: true,
      // Lets CI images that ship their own Chromium skip `playwright install`.
      executablePath: process.env.PATOOL_CHROMIUM_PATH || undefined,
    });

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
      });
      const page = await context.newPage();
      let loaded = false;

      for (const route of ROUTES) {
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        try {
          if (!loaded) {
            await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
            loaded = true;
          } else {
            // Client-side navigation: much faster than a dev-server reload, and
            // it is the path a real user takes through the nav.
            await page.evaluate((target) => {
              window.history.pushState({}, "", target);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }, route);
          }
          await page.waitForTimeout(SETTLE_MS);

          const result = await page.evaluate(probeLayout);
          const label = `[${viewport.name} ${viewport.width}px] ${route}`;

          if (!result.rendered) {
            failures.push(`${label}: rendered no page content`);
          }
          if (result.scrollWidth > result.docWidth + 1) {
            const worst = result.offenders
              .map((o) => `<${o.tag} class="${o.cls}"> right=${o.right} w=${o.width} :: ${o.text}`)
              .join("\n      ");
            failures.push(
              `${label}: document scrolls sideways (${result.scrollWidth} > ${result.docWidth})`
              + (worst ? `\n      ${worst}` : ""),
            );
          }
          if (result.mainScrollsSideways) {
            failures.push(`${label}: main column scrolls sideways`);
          }
          for (const error of pageErrors) {
            failures.push(`${label}: page error: ${error}`);
          }
        } catch (error) {
          failures.push(`[${viewport.name}] ${route}: ${error.message}`);
        }

        page.removeAllListeners("pageerror");
      }

      await context.close();
    }
  } catch (error) {
    console.error(error.message);
    console.error(recentOutput.join(""));
    process.exitCode = 1;
    return;
  } finally {
    await browser?.close();
    await stopAppServer(server);
  }

  const checks = VIEWPORTS.length * ROUTES.length;
  if (failures.length > 0) {
    console.error(`Responsive layout check failed (${failures.length} of ${checks} checks):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Responsive layout OK: ${checks} checks across ${VIEWPORTS.length} viewports.`);
}

await main();
