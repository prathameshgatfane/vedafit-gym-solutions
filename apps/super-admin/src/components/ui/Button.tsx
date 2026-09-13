import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-brand-green text-brand-black hover:bg-brand-green-muted focus-visible:outline-brand-green",
  secondary:
    "bg-brand-black-88 text-brand-white border border-brand-white/20 hover:border-brand-green focus-visible:outline-brand-green",
  danger:
    "bg-brand-black-88 text-red-300 border border-red-400/40 hover:border-red-400 focus-visible:outline-red-400",
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
