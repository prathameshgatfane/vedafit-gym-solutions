import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/**
 * Colours come from semantic tokens (`bg-accent`, `text-fg`, …) backed by CSS variables in
 * `index.css`. Dark values stay locked to Section 1.14; lime is fill-only (`text-accent-fg`).
 */
const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:brightness-110 focus-visible:outline-accent",
  secondary:
    "bg-surface text-fg border border-fg/20 hover:border-accent hover:bg-accent/10 focus-visible:outline-accent",
  danger:
    "bg-surface text-danger border border-danger/40 hover:border-danger focus-visible:outline-danger",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold",
        "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
