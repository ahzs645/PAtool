#!/usr/bin/env node
/**
 * Extract equation documentation from the source so the Equations reference
 * page is generated from the code, not hand-maintained separately.
 *
 * Annotate an equation with a JSDoc block next to its implementation:
 *
 *   /**
 *    * @equation barkjohn-2021
 *    * @title Barkjohn 2021 US-wide PurpleAir correction
 *    * @category Corrections
 *    * @latex PM_{2.5} = 0.524\,PA_{cf1} - 0.0862\,RH + 5.75
 *    * @var PA_{cf1} | PurpleAir CF=1 PM2.5 (ug/m3)
 *    * @var RH | relative humidity (%)
 *    * @cite Barkjohn et al. 2021, AMT
 *    *\/
 *
 * Tags: @equation <id> (required), @title, @category, @latex (repeatable for
 * piecewise/multi-line), @plain, @var <symbol> | <meaning> (repeatable), @cite.
 * Writes shared/src/generated/equations.json (sorted by category, then title)
 * with the source file + line recorded for each entry.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = [join(root, "shared", "src"), join(root, "app", "src")];
const OUT = join(root, "shared", "src", "generated", "equations.json");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === "node_modules") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) yield p;
  }
}

const BLOCK_RE = /\/\*\*[\s\S]*?\*\//g;
const equations = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    let m;
    while ((m = BLOCK_RE.exec(text))) {
      const block = m[0];
      if (!block.includes("@equation")) continue;
      const line = text.slice(0, m.index).split("\n").length;
      // Strip the comment framing and leading " * " from each line.
      const body = block
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .split("\n")
        .map((l) => l.replace(/^\s*\*?\s?/, ""))
        .join("\n");

      const eq = { id: "", title: "", category: "Other", latex: [], plain: "", vars: [], cite: "", file: relative(root, file), line };
      let current = null;
      for (const raw of body.split("\n")) {
        const tag = raw.match(/^@(\w+)\s?(.*)$/);
        if (tag) {
          const [, name, value] = tag;
          current = name;
          if (name === "equation") eq.id = value.trim();
          else if (name === "title") eq.title = value.trim();
          else if (name === "category") eq.category = value.trim();
          else if (name === "latex") eq.latex.push(value.trim());
          else if (name === "plain") eq.plain = value.trim();
          else if (name === "cite") eq.cite = value.trim();
          else if (name === "var") {
            const [sym, ...rest] = value.split("|");
            eq.vars.push({ symbol: sym.trim(), meaning: rest.join("|").trim() });
          }
        } else if (current && raw.trim()) {
          // Continuation of the previous multi-line tag.
          if (current === "latex") eq.latex.push(raw.trim());
          else if (current === "title") eq.title += ` ${raw.trim()}`;
          else if (current === "plain") eq.plain += ` ${raw.trim()}`;
          else if (current === "cite") eq.cite += ` ${raw.trim()}`;
        }
      }
      if (eq.id && eq.latex.length) equations.push(eq);
      else console.warn(`Skipping incomplete @equation in ${eq.file}:${eq.line} (need id + latex)`);
    }
  }
}

equations.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
writeFileSync(OUT, `${JSON.stringify(equations, null, 2)}\n`);
const byCat = equations.reduce((acc, e) => ((acc[e.category] = (acc[e.category] ?? 0) + 1), acc), {});
console.log(`Extracted ${equations.length} equations -> ${relative(root, OUT)}`);
console.log("By category:", byCat);
