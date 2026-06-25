import { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { EQUATIONS, equationCategories, type EquationDoc } from "@patool/shared";

import { Card, PageHeader, StatCard } from "../components";
import styles from "./ToolsetPage.module.css";

const REPO_BLOB = "https://github.com/ahzs645/PAtool/blob/claude/practical-maxwell-4nqqsw";

function Katex({ tex, display }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
    } catch {
      return `<code>${tex}</code>`;
    }
  }, [tex, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function EquationCard({ equation }: { equation: EquationDoc }) {
  return (
    <div style={{ padding: "var(--spacing-3) 0", borderTop: "1px solid var(--border-medium)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: "var(--font-size-md)" }}>{equation.title}</strong>
        <a
          href={`${REPO_BLOB}/${equation.file}#L${equation.line}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: "var(--font-size-xs)", color: "var(--accent-text)", fontFamily: "monospace" }}
        >
          {equation.file}:{equation.line}
        </a>
      </div>
      <div style={{ overflowX: "auto", padding: "var(--spacing-2) 0" }}>
        {equation.latex.map((line, i) => (
          <div key={i} style={{ padding: "2px 0" }}>
            <Katex tex={line} display />
          </div>
        ))}
      </div>
      {equation.plain && <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-sm)" }}>{equation.plain}</p>}
      {equation.vars.length > 0 && (
        <table style={{ borderCollapse: "collapse", marginTop: "var(--spacing-2)", fontSize: "var(--font-size-sm)" }}>
          <tbody>
            {equation.vars.map((v) => (
              <tr key={v.symbol}>
                <td style={{ padding: "2px 12px 2px 0", verticalAlign: "top" }}><Katex tex={v.symbol} /></td>
                <td style={{ padding: "2px 0", color: "var(--text-secondary)" }}>{v.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {equation.cite && (
        <p style={{ marginTop: "var(--spacing-1)", fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
          Source: {equation.cite}
        </p>
      )}
    </div>
  );
}

export default function EquationsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = useMemo(() => ["All", ...equationCategories()], []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EQUATIONS.filter((equation) => {
      if (category !== "All" && equation.category !== category) return false;
      if (!q) return true;
      return [equation.title, equation.category, equation.cite, equation.id, equation.plain, ...equation.vars.map((v) => v.meaning)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [query, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, EquationDoc[]>();
    for (const equation of filtered) {
      const list = map.get(equation.category) ?? [];
      list.push(equation);
      map.set(equation.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Reference"
        title="Equations used across PAtool"
        subtitle="Generated from @equation annotations in the source by scripts/extract_equations.mjs — a single source of truth that lives next to the code, not a hand-maintained list. Each card links to the implementing line."
      />

      <div className={styles.stats}>
        <StatCard label="Equations" value={`${EQUATIONS.length}`} />
        <StatCard label="Categories" value={`${equationCategories().length}`} />
        <StatCard label="Showing" value={`${filtered.length}`} />
      </div>

      <Card title="Browse">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Search</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="correction, RMSE, kriging…" />
          </label>
          <label className={styles.field}>
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {grouped.map(([cat, items]) => (
        <Card key={cat} title={`${cat} (${items.length})`}>
          {items.map((equation) => (
            <EquationCard key={equation.id} equation={equation} />
          ))}
        </Card>
      ))}

      {filtered.length === 0 && <Card title="No matches"><p>No equations match your search.</p></Card>}
    </div>
  );
}
