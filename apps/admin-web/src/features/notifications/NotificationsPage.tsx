import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import {
  DEFAULT_NOTIFICATION_LIST_PARAMS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_LOG_STATUSES,
  type NotificationEvent,
  type NotificationLogStatus,
  type NotificationSortField,
} from "./notification.types";
import {
  useNotificationLogs,
  useNotificationTemplates,
  useRunNotificationScan,
} from "./useNotifications";

const CONFIG: ListParamsConfig<NotificationSortField, NotificationLogStatus> = {
  sortFields: ["createdAt", "sentAt", "event"],
  statuses: NOTIFICATION_LOG_STATUSES,
  defaults: DEFAULT_NOTIFICATION_LIST_PARAMS,
};

export function NotificationsPage() {
  const { params, setParams, reset } = useUrlListParams(CONFIG);
  const { data, isPending, isFetching, isError, error, refetch } = useNotificationLogs(params);
  const templates = useNotificationTemplates();
  const run = useRunNotificationScan();
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const logs = data?.items ?? [];
  const pagination = data?.pagination;
  const hasQueued = logs.some((log) => log.status === "QUEUED");

  useEffect(() => {
    if (!hasQueued) return;
    const timer = setInterval(() => void refetch(), 1000);
    return () => clearInterval(timer);
  }, [hasQueued, refetch]);

  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);
  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  async function onRun() {
    setRunMessage(null);
    try {
      const result = await run.mutateAsync();
      setRunMessage(
        `Queued ${result.queued}, skipped ${result.skipped} already intended today.`,
      );
    } catch (err) {
      setRunMessage(apiErrorMessage(err, "Could not run the nightly scan."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 data-testid="notifications-heading" className="text-2xl font-semibold text-brand-white">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-brand-green-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "log" : "logs"}`
              : "Loading notification history…"}
          </p>
        </div>
        <Button data-testid="run-nightly" onClick={() => void onRun()} disabled={run.isPending}>
          {run.isPending ? "Scanning…" : "Run nightly scan"}
        </Button>
      </div>

      <p className="rounded-md border border-brand-green/25 bg-brand-green/5 px-4 py-3 text-sm text-brand-green-muted">
        Log-only sender — nothing leaves this gym yet. The unique key is one SMS per member event
        per gym-local day, so running twice today will not double-queue.
      </p>

      {runMessage ? (
        <p role="status" data-testid="run-result" className="text-sm text-brand-white">
          {runMessage}
        </p>
      ) : null}

      {isError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load notification logs.")}
        </p>
      ) : null}

      <div
        data-testid="notifications-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Member or message"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </div>
        <Select
          label="Status"
          placeholder="Any status"
          options={NOTIFICATION_LOG_STATUSES.map((value) => ({ value, label: value }))}
          value={params.status}
          onChange={(event) =>
            setParams({ status: (event.target.value || "") as NotificationLogStatus | "" })
          }
        />
        <Select
          label="Sort by"
          options={[
            { value: "createdAt", label: "Recorded" },
            { value: "sentAt", label: "Sent" },
            { value: "event", label: "Event" },
          ]}
          value={params.sortBy}
          onChange={(event) => setParams({ sortBy: event.target.value as NotificationSortField })}
        />
        {params.search || params.status ? (
          <Button variant="secondary" className="col-span-2 md:col-auto" onClick={reset}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataTable>
        <table data-testid="notifications-table" className="w-full text-left text-sm">
          <thead className="bg-brand-black-88 text-xs uppercase tracking-wide text-brand-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Message</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-brand-white/5 ${isFetching && !isPending ? "opacity-60" : ""}`}
          >
            {isPending ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  Loading notification history…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-white/50">
                  No notifications yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  data-testid="notification-row"
                  data-log-id={log.id}
                  data-status={log.status}
                  className="bg-brand-black"
                >
                  <td className="px-4 py-3 text-brand-white/70">{log.localDate}</td>
                  <td className="px-4 py-3 text-brand-white">
                    {log.member
                      ? `${log.member.firstName} ${log.member.lastName}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-brand-white">
                    {NOTIFICATION_EVENT_LABELS[log.event as NotificationEvent] ?? log.event}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="px-4 py-3 text-brand-white/70">{log.body}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {templates.data && templates.data.length > 0 ? (
        <section className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-6">
          <h2 className="text-lg font-semibold text-brand-white">Templates</h2>
          <ul data-testid="notification-templates" className="mt-3 space-y-3 text-sm">
            {templates.data.map((template) => (
              <li key={template.id}>
                <p className="font-medium text-brand-white">
                  {NOTIFICATION_EVENT_LABELS[template.event]} · {template.channel}
                </p>
                <p className="text-brand-white/60">{template.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
