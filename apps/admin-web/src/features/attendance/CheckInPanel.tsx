import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { apiErrorCode, apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { useMemberList } from "../members/useMembers";
import { DEFAULT_LIST_PARAMS, type Member } from "../members/member.types";
import {
  formatCheckInTime,
  overrideLabel,
  type AttendanceOverrideReason,
} from "./attendance.types";
import { useMarkAttendance } from "./useAttendance";

interface CheckInPanelProps {
  /** The branch the desk is standing at. Required for org-wide staff (1.17.3). */
  branchId: string;
  branchName: string;
}

/**
 * Refused because nothing covers the member. Held in state rather than acted on, because 1.17.1
 * makes recording it anyway a deliberate second act — the confirm below is where a human takes
 * responsibility, and the server asks for `override: true` before it will write the row.
 */
interface PendingOverride {
  member: Member;
  reason: AttendanceOverrideReason | null;
  message: string;
}

type Outcome =
  | { kind: "checked-in"; name: string; time: string; overridden: boolean }
  | { kind: "already"; name: string; time: string };

export function CheckInPanel({ branchId, branchName }: CheckInPanelProps) {
  const timeZone = useSessionStore((s) => s.organization?.timezone ?? "UTC");

  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingOverride | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Same 300ms debounce the list screens use — one request per pause, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft]);

  // Search-first: no roster is fetched until the desk has typed something, because a list of
  // eight arbitrary members is not an answer to "who is standing in front of me".
  const results = useMemberList(
    {
      ...DEFAULT_LIST_PARAMS,
      search,
      status: "ACTIVE",
      limit: 8,
      sortBy: "firstName",
      sortOrder: "asc",
    },
    { enabled: search !== "" },
  );

  const mark = useMarkAttendance();

  function checkIn(member: Member, override: boolean) {
    setError(null);
    // Clear the last result before starting: leaving "Aarav checked in" on screen while the desk
    // is halfway through checking in Esha invites reading the wrong person's confirmation.
    setOutcome(null);
    mark.mutate(
      { memberId: member.id, branchId, override },
      {
        onSuccess: ({ attendance, alreadyCheckedIn }) => {
          setPending(null);
          setDraft("");
          setSearch("");
          const name = `${member.firstName} ${member.lastName}`;
          const time = formatCheckInTime(attendance.checkedInAt, timeZone);
          setOutcome(
            alreadyCheckedIn
              ? { kind: "already", name, time }
              : { kind: "checked-in", name, time, overridden: attendance.isOverride },
          );
        },
        onError: (err) => {
          // The one error that isn't a failure: it is the server asking whether we meant it.
          if (apiErrorCode(err) === "MEMBERSHIP_NOT_ACTIVE") {
            const details = (err as { response?: { data?: { error?: { details?: unknown } } } })
              .response?.data?.error?.details as { reason?: AttendanceOverrideReason } | undefined;
            setPending({
              member,
              reason: details?.reason ?? null,
              message: apiErrorMessage(err, "This member has no active membership"),
            });
            return;
          }
          setPending(null);
          setError(apiErrorMessage(err, "Could not record the check-in"));
        },
      },
    );
  }

  const members = results.data?.items ?? [];
  const busy = mark.isPending;

  return (
    <section
      data-testid="check-in-panel"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">Check in a member</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Recording arrivals at <span className="text-accent-muted">{branchName}</span>.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <TextField
          label="Search by name or phone"
          type="search"
          data-testid="check-in-search"
          placeholder="Start typing a name or number…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>

      {outcome ? (
        <div
          role="status"
          data-testid="check-in-outcome"
          className={
            outcome.kind === "already"
              ? "mt-4 rounded-md border border-fg/15 bg-fg/5 px-4 py-3 text-sm text-fg/70"
              : "mt-4 rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent-muted"
          }
        >
          {outcome.kind === "already" ? (
            <>
              <span className="font-semibold text-fg">{outcome.name}</span> already checked
              in today at {outcome.time}. Nothing was recorded twice.
            </>
          ) : (
            <>
              <span className="font-semibold text-fg">{outcome.name}</span> checked in at{" "}
              {outcome.time}
              {outcome.overridden ? " — recorded as an override." : "."}
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {pending ? (
        <div
          role="alertdialog"
          aria-label="Confirm override"
          data-testid="override-confirm"
          className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3"
        >
          <p className="text-sm font-semibold text-warning">
            {pending.reason ? overrideLabel(pending.reason) : "No active membership"}
          </p>
          <p className="mt-1 text-sm text-fg/70">{pending.message}</p>
          <p className="mt-2 text-xs text-fg-muted">
            Checking them in anyway is recorded as an override against your name, and shows up in
            reports.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              data-testid="override-confirm-button"
              disabled={busy}
              onClick={() => checkIn(pending.member, true)}
            >
              {busy ? "Recording…" : "Check in anyway"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {search === "" ? (
        <p className="mt-4 text-sm text-fg-muted">
          Search for a member to check them in.
        </p>
      ) : (
        <ul data-testid="check-in-results" className="mt-4 divide-y divide-fg/5">
          {results.isPending ? (
            <li className="py-3 text-sm text-fg-muted">Searching…</li>
          ) : members.length === 0 ? (
            <li className="py-3 text-sm text-fg-muted">
              Nobody matches “{search}”.
            </li>
          ) : (
            members.map((member) => (
              <li
                key={member.id}
                data-testid="check-in-result"
                className="flex items-center justify-between gap-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-fg">
                    {member.firstName} {member.lastName}
                  </p>
                  <p className="text-xs text-fg-muted">{member.phone}</p>
                </div>
                <Button
                  data-testid={`check-in-${member.id}`}
                  disabled={busy}
                  onClick={() => checkIn(member, false)}
                >
                  Check in
                </Button>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
