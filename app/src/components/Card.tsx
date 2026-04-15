import styles from "./Card.module.css";

interface CardProps {
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
  title?: string;
}

export function Card({ children, padded = true, className, title }: CardProps) {
  return (
    <section className={`${styles.card} ${padded ? styles.padded : ""} ${className ?? ""}`}>
      {title && <h2 className={styles.cardTitle}>{title}</h2>}
      {children}
    </section>
  );
}
