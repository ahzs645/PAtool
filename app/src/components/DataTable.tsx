import { type ReactNode, useState, useEffect, useMemo } from "react";
import styles from "./DataTable.module.css";

/* ── Column definition ── */
export interface Column<T> {
  key: string;
  header: string;
  width?: number | string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
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

  // Reset to page 1 when data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [data]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!activeHeaderMenu) return;
    const handler = () => setActiveHeaderMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [activeHeaderMenu]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(data.length / pageSize)) : 1;

  const visibleData = useMemo(() => {
    if (!pageSize) return data;
    const start = (currentPage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, currentPage, pageSize]);

  return (
    <div>
      {/* Header */}
      <div className={styles.headerRow}>
        {columns.map((col) => (
          <div
            key={col.key}
            className={`${styles.headerCell} ${styles.headerClickable}`}
            style={{ width: col.width, minWidth: col.width }}
            onClick={(e) => {
              e.stopPropagation();
              setActiveHeaderMenu(activeHeaderMenu === col.key ? null : col.key);
            }}
          >
            {col.header}
            {activeHeaderMenu === col.key && (
              <div className={styles.headerMenu} onClick={(e) => e.stopPropagation()}>
                <button className={styles.headerMenuItem} onClick={() => setActiveHeaderMenu(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                  </svg>
                  Filter
                </button>
                <button className={styles.headerMenuItem} onClick={() => setActiveHeaderMenu(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h7" /><path d="M4 12h7" /><path d="M4 18h9" />
                    <path d="M15 9l3 -3l3 3" /><path d="M18 6v12" />
                  </svg>
                  Sort ascending
                </button>
                <button className={styles.headerMenuItem} onClick={() => setActiveHeaderMenu(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h9" /><path d="M4 12h7" /><path d="M4 18h7" />
                    <path d="M15 15l3 3l3 -3" /><path d="M18 6v12" />
                  </svg>
                  Sort descending
                </button>
                <div className={styles.headerMenuDivider} />
                <button className={styles.headerMenuItem} onClick={() => setActiveHeaderMenu(null)}>
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
        ))}
      </div>

      {/* Body */}
      <div className={styles.tbody}>
        {visibleData.length === 0 ? (
          <div className={styles.empty}>{emptyMessage}</div>
        ) : (
          visibleData.map((row) => {
            const key = rowKey(row);
            const isSelected = selectedRowKey != null && key === selectedRowKey;
            return (
              <div
                key={key}
                className={`${styles.row} ${onRowClick ? styles.rowClickable : ""} ${isSelected ? styles.rowSelected : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
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
      {footer && <div className={styles.footer}>{footer}</div>}
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
}: {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  const variantClass =
    variant === "default"
      ? styles.chip
      : `${styles.chip} ${styles[`chip${variant.charAt(0).toUpperCase()}${variant.slice(1)}`]}`;
  return <span className={variantClass}>{children}</span>;
}
