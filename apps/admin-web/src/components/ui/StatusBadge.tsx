import type { MemberStatus } from "../../features/members/member.types";

/**
 * Brand green is the "everything is fine" signal, so only ACTIVE gets it. Archived deliberately
 * recedes rather than reading as an error — it's a normal end state, not a failure.
 */
const styles: Record<MemberStatus, string> = {
  ACTIVE: "bg-brand-green/15 text-brand-green border-brand-green/40",
  INACTIVE: "bg-brand-white/10 text-brand-white/70 border-brand-white/25",
  ARCHIVED: "bg-brand-black text-brand-white/40 border-brand-white/15",
};

export function StatusBadge({ status }: { status: MemberStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
