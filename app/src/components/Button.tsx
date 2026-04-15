import styles from "./Button.module.css";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "accent";
  size?: "default" | "small";
}

export function Button({
  variant = "primary",
  size = "default",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${styles.button} ${styles[variant]} ${size === "small" ? styles.small : ""} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
