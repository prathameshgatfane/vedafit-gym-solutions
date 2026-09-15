interface SpinnerProps {
  label?: string;
}

/** Full-height loading state, used while the session bootstraps on cold load. */
export function Spinner({ label = "Loading" }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-bg"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg/20 border-t-accent" />
        <span className="text-sm text-accent-muted">{label}</span>
      </div>
    </div>
  );
}
