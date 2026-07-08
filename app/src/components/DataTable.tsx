import { type ReactNode, useState, useEffect, useMemo } from "react";
import styles from "./DataTable.module.css";

/* ── Column definition ── */
export interface Column<T> {
  key: string;
  header: string;
  width?: number | string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | boolean | null | undefined;
  filterValue?: (row: T) => string | number | boolean | null | undefined;
}

type SortDirection = "asc" | "desc";

function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join(" ");
  if (typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode; primary?: ReactNode; sub?: ReactNode };
    return [props.primary, props.sub, props.children].map(nodeToText).filter(Boolean).join(" ");
  }
  return "";
}

function normalizeValue(value: string | number | boolean | null | undefined): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value ?? "").toLocaleLowerCase();
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/* ── Props ── */
interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string | number | null;
  emptyMessage?: string;
  footer?: ReactNode;
  pageSize?: number;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  selectedRowKey,
  emptyMessage = "No data",
  footer,
  pageSize,
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [activeHeaderMenu, setActiveHeaderMenu] = useState<string | null>(null);
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.has(column.key)),
    [columns, hiddenColumns],
  );

  // Reset to page 1 when data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [data, filters, sort]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!activeHeaderMenu) return;
    const handler = () => setActiveHeaderMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [activeHeaderMenu]);

  const processedData = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== "");
    const next = activeFilters.length
      ? data.filter((row) =>
          activeFilters.every(([key, value]) => {
            const column = columns.find((item) => item.key === key);
            if (!column) return true;
            const rawValue = column.filterValue?.(row) ?? column.sortValue?.(row) ?? nodeToText(column.render(row));
            return String(rawValue ?? "").toLocaleLowerCase().includes(value.trim().toLocaleLowerCase());
          }),
        )
      : [...data];

    if (!sort) return next;

    const column = columns.find((item) => item.key === sort.key);
    if (!column) return next;

    return [...next].sort((a, b) => {
      const aValue = normalizeValue(column.sortValue?.(a) ?? column.filterValue?.(a) ?? nodeToText(column.render(a)));
      const bValue = normalizeValue(column.sortValue?.(b) ?? column.filterValue?.(b) ?? nodeToText(column.render(b)));
      const result = compareValues(aValue, bValue);
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, data, filters, sort]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(processedData.length / pageSize)) : 1;

  const visibleData = useMemo(() => {
    if (!pageSize) return processedData;
    const start = (currentPage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, currentPage, pageSize]);

  const hideColumn = (key: string) => {
    if (visibleColumns.length <= 1) return;
    setHiddenColumns((previous) => {
      const next = new Set(previous);
      next.add(key);
      return next;
    });
    setActiveHeaderMenu(null);
  };

  return (
    <div className={styles.table} role="table">
      {/* Header */}
      <div className={styles.headerRow} role="row">
        {visibleColumns.map((col) => {
          const filterValue = filters[col.key] ?? "";
          const isSorted = sort?.key === col.key;
          return (
          <div
            key={col.key}
            role="columnheader"
            className={`${styles.headerCell} ${styles.headerClickable}`}
            style={{ width: col.width, minWidth: col.width }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveHeaderMenu(activeHeaderMenu === col.key ? null : col.key);
            }}
          >
            <span>{col.header}</span>
            {filterValue && <span className={styles.filterIndicator}>Filtered</span>}
            {isSorted && <span className={styles.sortIndicator}>{sort.direction === "asc" ? "Asc" : "Desc"}</span>}
            {activeHeaderMenu === col.key && (
              <div className={styles.headerMenu} onClick={(e) => e.stopPropagation()}>
                <button
                  className={styles.headerMenuItem}
                  aria-label={`Show filter for ${col.header}`}
                  onClick={() => setActiveFilterColumn(activeFilterColumn === col.key ? null : col.key)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                  </svg>
                  Filter
                </button>
                {activeFilterColumn === col.key && (
                  <div className={styles.headerFilter}>
                    <input
                      aria-label={`Filter ${col.header}`}
                      value={filterValue}
                      placeholder={`Filter ${col.header}`}
                      onChange={(event) =>
                        setFilters((previous) => ({
                          ...previous,
                          [col.key]: event.target.value,
                        }))
                      }
                    />
                    {filterValue && (
                      <button
                        type="button"
                        className={styles.clearFilter}
                        onClick={() =>
                          setFilters((previous) => {
                            const next = { ...previous };
                            delete next[col.key];
                            return next;
                          })
                        }
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
                <button
                  className={styles.headerMenuItem}
                  aria-label={`Sort ${col.header} ascending`}
                  onClick={() => {
                    setSort({ key: col.key, direction: "asc" });
                    setActiveHeaderMenu(null);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h7" /><path d="M4 12h7" /><path d="M4 18h9" />
                    <path d="M15 9l3 -3l3 3" /><path d="M18 6v12" />
                  </svg>
                  Sort ascending
                </button>
                <button
                  className={styles.headerMenuItem}
                  aria-label={`Sort ${col.header} descending`}
                  onClick={() => {
                    setSort({ key: col.key, direction: "desc" });
                    setActiveHeaderMenu(null);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h9" /><path d="M4 12h7" /><path d="M4 18h7" />
                    <path d="M15 15l3 3l3 -3" /><path d="M18 6v12" />
                  </svg>
                  Sort descending
                </button>
                <div className={styles.headerMenuDivider} />
                <button
                  className={styles.headerMenuItem}
                  aria-label={`Hide ${col.header}`}
                  onClick={() => hideColumn(col.key)}
                  disabled={visibleColumns.length <= 1}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                    <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                    <path d="M3 3l18 18" />
                  </svg>
                  Hide
                </button>
              </div>
            )}
          </div>
        );
        })}
      </div>

      {/* Body */}
      <div className={styles.tbody} role="rowgroup">
        {visibleData.length === 0 ? (
          <div className={styles.empty}>{emptyMessage}</div>
        ) : (
          visibleData.map((row, rowIndex) => {
            const key = rowKey(row);
            const isSelected = selectedRowKey != null && key === selectedRowKey;
            return (
              <div
                key={`${String(key)}-${currentPage}-${rowIndex}`}
                role="row"
                aria-selected={onRowClick ? isSelected : undefined}
                className={`${styles.row} ${onRowClick ? styles.rowClickable : ""} ${isSelected ? styles.rowSelected : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {visibleColumns.map((col) => (
                  <div
                    key={col.key}
                    role="cell"
                    className={styles.cell}
                    style={{ width: col.width, minWidth: col.width }}
                  >
                    {col.render(row)}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {pageSize && data.length > 0 && (
        <div className={styles.pagination}>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className={styles.pageButtons}>
            <button
              className={styles.pageButton}
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              className={styles.pageButton}
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      {(footer || hiddenColumns.size > 0 || Object.values(filters).some(Boolean) || sort) && (
        <div className={styles.footer}>
          <span>{footer}</span>
          <div className={styles.tableActions}>
            {processedData.length !== data.length && (
              <span>{processedData.length} matching</span>
            )}
            {(hiddenColumns.size > 0 || Object.values(filters).some(Boolean) || sort) && (
              <button
                type="button"
                className={styles.resetButton}
                onClick={() => {
                  setHiddenColumns(new Set());
                  setFilters({});
                  setSort(null);
                  setActiveHeaderMenu(null);
                  setActiveFilterColumn(null);
                }}
              >
                Reset table
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helper sub-components for cell content ── */

export function CellStack({ primary, sub }: { primary: ReactNode; sub?: ReactNode }) {
  return (
    <div className={styles.cellStack}>
      <span className={styles.cellStackPrimary}>{primary}</span>
      {sub && <span className={styles.cellStackSub}>{sub}</span>}
    </div>
  );
}

export function Chip({
  children,
  variant = "default",
  title,
}: {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "accent";
  title?: string;
}) {
  const variantClass =
    variant === "default"
      ? styles.chip
      : `${styles.chip} ${styles[`chip${variant.charAt(0).toUpperCase()}${variant.slice(1)}`]}`;
  return <span className={variantClass} title={title}>{children}</span>;
}
