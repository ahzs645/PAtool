import styles from "../ExplorerPage.module.css";

export function IconMapPin() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M8 14s5-3.5 5-7.5a5 5 0 1 0-10 0C3 10.5 8 14 8 14Z" />
    </svg>
  );
}

export function IconBuilding() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M5 5h2v2H5zM9 5h2v2H9zM5 9h2v2H5zM9 9h2v2H9z" />
    </svg>
  );
}

export function IconGauge() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12Z" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}

export function IconMap() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3.5l4.5-1.5 5 2 4.5-1.5v11l-4.5 1.5-5-2L1 14.5z" />
      <path d="M5.5 2v11M10.5 4v11" />
    </svg>
  );
}

export function IconClock() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconHome() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8l6-6 6 6" />
      <path d="M4 7v6a1 1 0 001 1h6a1 1 0 001-1V7" />
    </svg>
  );
}

export function IconTimeseries() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,12 4,7 7,9 10,4 13,6 15,2" />
      <line x1="1" y1="14" x2="15" y2="14" />
    </svg>
  );
}

export function IconHeart() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14s-5.5-3.5-5.5-7A3 3 0 0 1 8 4.5 3 3 0 0 1 13.5 7C13.5 10.5 8 14 8 14Z" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}
