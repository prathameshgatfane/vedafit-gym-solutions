type BadgeStatus = "ACTIVE" | "SUSPENDED" | "TRIAL" | "PAST_DUE" | "CANCELLED";

const styles: Record<BadgeStatus, string> = {
  ACTIVE: "bg-accent/15 text-accent-text border-accent/40",
  SUSPENDED: "bg-danger/10 text-danger border-danger/40",
  TRIAL: "bg-warning/10 text-warning border-warning/40",
  PAST_DUE: "bg-warning/10 text-warning border-warning/40",
  CANCELLED: "bg-bg text-fg-muted border-fg/15",
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
