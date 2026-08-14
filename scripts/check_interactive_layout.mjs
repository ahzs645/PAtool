/**
 * Interactive-state layout check.
 *
 * `check_responsive_layout.mjs` only ever sees each route as it first renders.
 * This one drives the controls inside the main column — expanding details,
 * toggling checkboxes, cycling selects, clicking buttons — and re-runs the
 * layout probe after every interaction, so it catches panels and messages that
 * only exist after the user does something.
 *
 * It reports two things a page must never do, and only when the interaction
 * introduced them:
 *   - the document starts scrolling sideways
 *   - content ends up clipped with nothing scrollable between it and the
 *     viewport, i.e. the user cannot reach it at all
 *
 * Usage: npm run test:interactive [-- /route,/route]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const SERVER_TIMEOUT_MS = 45_000;
const SETTLE_MS = 2_200;
const STEP_MS = 600;
const MAX_CONTROLS = Number(process.env.PATOOL_MAX_CONTROLS || 22);
const ROUTE_BUDGET_MS = Number(process.env.PATOOL_ROUTE_BUDGET_MS || 240_000);

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
  { name: "phone", width: 390, height: 844, isMobile: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

const SELECTORS = {
  details: "#patool-main summary",
  check: '#patool-main input[type="checkbox"], #patool-main input[type="radio"]',
  select: "#patool-main select",
  button: "#patool-main button:not([disabled])",
};

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => server.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

async function findAppPort() {
  const requested = Number(process.env.PATOOL_APP_PORT ?? 5187);
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
      env: { ...process.env, VITE_DATA_SOURCE: "static", BROWSER: "none", NO_UPDATE_NOTIFIER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own the process group: signalling only npm leaves Vite alive holding
      // this process's stdio pipes open, so the check never exits.
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
    try { process.kill(-child.pid, signal); } catch { /* group already gone */ }
  };
  if (child.exitCode == null) {
    signalGroup("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3_000)]);
    if (child.exitCode == null) signalGroup("SIGKILL");
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

function probeLayout() {
  const docWidth = document.documentElement.clientWidth;
  const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const main = document.getElementById("patool-main");

  const offenders = [];
  if (scrollWidth > docWidth + 1) {
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right <= docWidth + 1 && rect.left >= -1) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; }
      }
      if (clipped) continue;
      offenders.push(`<${el.tagName.toLowerCase()} class="${(typeof el.className === "string" ? el.className : "").slice(0, 44)}"> w=${Math.round(rect.width)} :: ${(el.textContent ?? "").trim().slice(0, 34)}`);
    }
  }

  const unreachable = [];
  if (main) {
    for (const el of main.querySelectorAll("*")) {
      // 8px of slack: KaTeX and similar emit 1-2px sub-pixel overshoots.
      if (el.scrollWidth <= el.clientWidth + 8) continue;
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX)) continue;
      if (cs.textOverflow === "ellipsis") continue;   // deliberate truncation
      if (cs.display === "inline") continue;
      let reachable = false;
      let hidden = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (/(auto|scroll)/.test(ox)) { reachable = true; break; }
        if (ox === "hidden") { hidden = true; break; }
      }
      if (reachable || !hidden) continue;
      unreachable.push(`<${el.tagName.toLowerCase()} class="${(typeof el.className === "string" ? el.className : "").slice(0, 44)}"> needs ${el.scrollWidth}px has ${el.clientWidth}px :: ${(el.textContent ?? "").trim().slice(0, 34)}`);
    }
  }

  return {
    overflow: scrollWidth > docWidth + 1 ? `${scrollWidth} > ${docWidth}` : null,
    mainSideways: main && main.scrollWidth > main.clientWidth + 1 ? `${main.scrollWidth} > ${main.clientWidth}` : null,
    offenders: [...new Set(offenders)].slice(0, 3),
    unreachable: [...new Set(unreachable)].slice(0, 3),
  };
}

function listControls([selectors, max]) {
  const out = [];
  for (const [kind, selector] of Object.entries(selectors)) {
    document.querySelectorAll(selector).forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      out.push({
        kind,
        index,
        label: (el.textContent || el.getAttribute("aria-label") || el.name || el.type || "").trim().slice(0, 40),
        options: kind === "select" ? [...el.options].map((o) => o.value).slice(0, 3) : undefined,
      });
    });
  }
  return out.slice(0, max);
}

async function main() {
  const routeArg = process.argv[2];
  const routes = routeArg ? routeArg.split(",") : ROUTES;
  const port = await findAppPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const recentOutput = [];
  const server = startAppServer(port, recentOutput);
  const failures = [];
  let interactions = 0;
  let browser;

  try {
    await waitForServer(baseUrl, server);
    browser = await chromium.launch({
      headless: true,
      // Lets CI images that ship their own Chromium skip `playwright install`.
      executablePath: process.env.PATOOL_CHROMIUM_PATH || undefined,
    });

    for (const viewport of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
        acceptDownloads: false,
      });

      let page;
      // A control may open a popup. Close those after each interaction rather
      // than on the `page` event, which also fires for pages we create here.
      const closePopups = async () => {
        for (const other of ctx.pages()) {
          if (other !== page) await other.close().catch(() => {});
        }
      };

      const sweepRoute = async (route) => {
        if (page) await page.close().catch(() => {});
        page = await ctx.newPage();
        page.on("dialog", (d) => d.dismiss().catch(() => {}));
        page.on("download", (d) => d.cancel().catch(() => {}));

        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 140)));

        await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(SETTLE_MS);

        const before = await page.evaluate(probeLayout);
        const controls = await page.evaluate(listControls, [SELECTORS, MAX_CONTROLS]);

        for (const control of controls) {
          try {
            // Re-locate by index every time: React re-renders replace nodes.
            const el = page.locator(SELECTORS[control.kind]).nth(control.index);
            if (!(await el.isVisible({ timeout: 1_200 }).catch(() => false))) continue;

            if (control.kind === "select") {
              for (const value of control.options) {
                await el.selectOption(value, { timeout: 2_000 }).catch(() => {});
                await page.waitForTimeout(STEP_MS);
              }
            } else {
              await el.click({ timeout: 2_000, force: true, noWaitAfter: true }).catch(() => {});
              await page.waitForTimeout(STEP_MS);
            }
            interactions++;
            await closePopups();
          } catch {
            continue;
          }

          // A control may have navigated away; return before probing.
          if (!page.url().includes(route)) {
            await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(1_500);
            continue;
          }

          const after = await page.evaluate(probeLayout);
          const newOverflow = after.overflow && !before.overflow;
          const newMain = after.mainSideways && !before.mainSideways;
          const newUnreachable = after.unreachable.filter((u) => !before.unreachable.includes(u));

          if (newOverflow || newMain || newUnreachable.length) {
            failures.push(
              `[${viewport.name}] ${route} — after ${control.kind} "${control.label}"`
              + (newOverflow ? `\n      document scrolls sideways (${after.overflow})\n      ${after.offenders.join("\n      ")}` : "")
              + (newMain ? `\n      main column scrolls sideways (${after.mainSideways})` : "")
              + (newUnreachable.length ? `\n      unreachable clipped content:\n      ${newUnreachable.join("\n      ")}` : ""),
            );
            // Re-baseline so one root cause is not reported on every later step.
            Object.assign(before, after);
          }
        }

        if (pageErrors.length) {
          failures.push(`[${viewport.name}] ${route} — page errors during interaction:\n      ${[...new Set(pageErrors)].slice(0, 3).join("\n      ")}`);
        }
      };

      for (const route of routes) {
        let timer;
        const budget = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("route budget exceeded")), ROUTE_BUDGET_MS);
        });
        try {
          await Promise.race([sweepRoute(route), budget]);
        } catch (error) {
          failures.push(`[${viewport.name}] ${route} — sweep aborted: ${error.message}`);
          // Racing does not cancel the sweep, so close the page it is driving.
          await page?.close().catch(() => {});
          page = undefined;
        } finally {
          clearTimeout(timer);
        }
      }

      await ctx.close();
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

  if (failures.length > 0) {
    console.error(`Interactive layout check failed (${failures.length} finding(s)):\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Interactive layout OK: ${interactions} interactions across ${routes.length} routes x ${VIEWPORTS.length} viewports.`);
}

await main();
