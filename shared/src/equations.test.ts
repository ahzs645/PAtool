import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EQUATIONS } from "./equations";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * These tests keep the Equations registry honest: every entry must point at a
 * real source location, and the distinctive numeric coefficients shown in the
 * rendered LaTeX must actually appear in the implementing file. That ties the
 * documented equation to the code — if a coefficient changes in one place but
 * not the other, this fails (so the page can't silently drift from reality).
 */
describe("equations registry is implied from the code", () => {
  it("has at least the core equations and unique ids", () => {
    expect(EQUATIONS.length).toBeGreaterThanOrEqual(16);
    const ids = EQUATIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry is well-formed", () => {
    for (const eq of EQUATIONS) {
      expect(eq.id, `id for ${eq.title}`).toMatch(/^[a-z0-9-]+$/);
      expect(eq.title.length, `title for ${eq.id}`).toBeGreaterThan(0);
      expect(eq.latex.length, `latex for ${eq.id}`).toBeGreaterThan(0);
      expect(eq.category.length, `category for ${eq.id}`).toBeGreaterThan(0);
      expect(eq.line, `line for ${eq.id}`).toBeGreaterThan(0);
    }
  });

  it("points at a real source file + line for every equation", () => {
    for (const eq of EQUATIONS) {
      const filePath = join(repoRoot, eq.file);
      expect(existsSync(filePath), `${eq.id} -> ${eq.file} should exist`).toBe(true);
      const lineCount = readFileSync(filePath, "utf8").split("\n").length;
      expect(eq.line, `${eq.id} line within ${eq.file}`).toBeLessThanOrEqual(lineCount);
    }
  });

  it("documented coefficients appear in the implementing source", () => {
    for (const eq of EQUATIONS) {
      const source = readFileSync(join(repoRoot, eq.file), "utf8");
      // Distinctive constants = decimal numbers in the LaTeX (e.g. 0.524, 1.4826).
      // Integers and fractions like 3/2 are skipped (too common to be meaningful).
      const constants = [...new Set((eq.latex.join(" ").match(/\d+\.\d+/g) ?? []))];
      for (const constant of constants) {
        expect(
          source.includes(constant),
          `${eq.id}: coefficient ${constant} from the LaTeX should appear in ${eq.file}`,
        ).toBe(true);
      }
    }
  });
});
