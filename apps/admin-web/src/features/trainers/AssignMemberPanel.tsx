import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useMemberList } from "../members/useMembers";
import { DEFAULT_LIST_PARAMS } from "../members/member.types";
import { useAssignTrainerMember } from "./useTrainers";

interface AssignMemberPanelProps {
  trainerId: string;
  assignedMemberIds: string[];
}

export function AssignMemberPanel({ trainerId, assignedMemberIds }: AssignMemberPanelProps) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft]);

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

  const assign = useAssignTrainerMember(trainerId);
  const assigned = new Set(assignedMemberIds);
  const members = (results.data?.items ?? []).filter((member) => !assigned.has(member.id));

  function onAssign(memberId: string) {
    setError(null);
    assign.mutate(memberId, {
      onSuccess: () => {
        setDraft("");
        setSearch("");
      },
      onError: (err) => {
        setError(apiErrorMessage(err, "Could not assign this member."));
      },
    });
  }

  return (
    <section
      data-testid="assign-member-panel"
      className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-6"
    >
      <h2 className="text-lg font-semibold text-brand-white">Assign a member</h2>
      <p className="mt-1 text-sm text-brand-white/50">
        Search the gym roster. Assigned members see this trainer; unassigning drops that access.
      </p>

      <div className="mt-4 max-w-md">
        <TextField
          label="Search members"
          type="search"
          data-testid="assign-search"
          placeholder="Name or phone"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {search === "" ? (
        <p className="mt-3 text-sm text-brand-white/40">Type a name or phone to find someone.</p>
      ) : results.isPending ? (
        <p className="mt-3 text-sm text-brand-white/50">Searching…</p>
      ) : members.length === 0 ? (
        <p className="mt-3 text-sm text-brand-white/50">No unassigned members match that search.</p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-white/5 rounded-md border border-brand-white/10">
          {members.map((member) => (
            <li
              key={member.id}
              data-testid="assign-result"
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-brand-white">
                  {member.firstName} {member.lastName}
                </p>
                <p className="text-xs text-brand-white/50">{member.phone}</p>
              </div>
              <Button
                data-testid="assign-button"
                variant="secondary"
                disabled={assign.isPending}
                onClick={() => onAssign(member.id)}
              >
                Assign
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
