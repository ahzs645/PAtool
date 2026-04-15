import styles from "./StatCard.module.css";

interface StatCardProps {
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
}

export function StatCard({ label, value, tone = "neutral" }: StatCardProps) {
  const toneClass = tone !== "neutral" ? styles[tone] : "";
  return (
    <article className={`${styles.statCard} ${toneClass}`}>
      <span className={styles.label}>{label}</span>
      <strong className={styles.value}>{value}</strong>
    </article>
  );
}
