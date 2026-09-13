type BadgeStatus = "ACTIVE" | "SUSPENDED" | "TRIAL" | "PAST_DUE" | "CANCELLED";

const styles: Record<BadgeStatus, string> = {
  ACTIVE: "bg-brand-green/15 text-brand-green border-brand-green/40",
  SUSPENDED: "bg-red-500/10 text-red-300 border-red-400/40",
  TRIAL: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  PAST_DUE: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  CANCELLED: "bg-brand-black text-brand-white/40 border-brand-white/15",
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
