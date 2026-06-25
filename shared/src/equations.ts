import equationsJson from "./generated/equations.json";

/**
 * Equation documentation extracted from `@equation` JSDoc annotations across
 * the source by scripts/extract_equations.mjs. The Equations reference page
 * renders this registry, so the equations stay a single source of truth that
 * lives next to the code that implements them.
 */
export type EquationVar = { symbol: string; meaning: string };

export type EquationDoc = {
  id: string;
  title: string;
  category: string;
  /** One entry per line (piecewise / multi-line equations have several). */
  latex: string[];
  plain: string;
  vars: EquationVar[];
  cite: string;
  /** Source file (repo-relative) and line of the annotation. */
  file: string;
  line: number;
};

export const EQUATIONS = equationsJson as EquationDoc[];

export function equationCategories(): string[] {
  return [...new Set(EQUATIONS.map((equation) => equation.category))].sort();
}
