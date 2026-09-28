import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { copyText } from "../../lib/clipboard";

export interface OwnerCredentialsPanelProps {
  organizationName: string;
  planLabel: string;
  subscriptionStatus: string;
  billingInterval: string;
  ownerEmail: string;
  temporaryPassword: string | null;
  onContinue: () => void;
}

export function OwnerCredentialsPanel({
  organizationName,
  planLabel,
  subscriptionStatus,
  billingInterval,
  ownerEmail,
  temporaryPassword,
  onContinue,
}: OwnerCredentialsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  async function copyPassword() {
    if (!temporaryPassword) return;
    const ok = await copyText(temporaryPassword);
    if (ok) {
      setCopied(true);
      setCopyError(null);
      return;
    }
    setCopied(false);
    setCopyError("Could not copy. Please copy the password manually.");
  }

  function requestContinue() {
    if (temporaryPassword && !copied) {
      setConfirmClose(true);
      return;
    }
    onContinue();
  }

  return (
    <div
      role="status"
      data-testid="org-credentials-panel"
      className="mx-auto w-full max-w-2xl rounded-lg border border-warning/40 bg-warning/5 p-6"
    >
      <h1 className="text-2xl font-semibold text-fg">Organization created successfully</h1>
      <p className="mt-1 text-lg font-medium text-fg">{organizationName}</p>
      {temporaryPassword ? (
        <p className="mt-2 text-sm text-warning">
          This temporary password will not be shown again. Copy or securely record it before
          closing this panel.
        </p>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">Owner credentials configured.</p>
      )}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Plan</dt>
          <dd data-testid="credentials-plan">{planLabel}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Subscription</dt>
          <dd data-testid="credentials-status">{subscriptionStatus}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Billing</dt>
          <dd data-testid="credentials-billing">{billingInterval}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Owner</dt>
          <dd data-testid="credentials-email" className="font-mono">
            {ownerEmail}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-fg-muted">{temporaryPassword ? "Temporary password" : "Password"}</dt>
          <dd data-testid="credentials-temp-password" className="mt-1 font-mono text-fg">
            {temporaryPassword ? (hidden ? "••••••••••" : temporaryPassword) : "Set by administrator"}
          </dd>
        </div>
      </dl>

      {copyError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {copyError}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        {temporaryPassword ? (
          <>
            <Button type="button" data-testid="credentials-copy" onClick={() => void copyPassword()}>
              {copied ? "Copied" : "Copy password"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="credentials-toggle"
              onClick={() => setHidden((value) => !value)}
            >
              {hidden ? "Show password" : "Hide password"}
            </Button>
          </>
        ) : null}
        <Button type="button" data-testid="credentials-continue" onClick={requestContinue}>
          Continue to organization
        </Button>
      </div>

      {confirmClose ? (
        <ConfirmDialog
          title="Close the credential panel?"
          message="You are about to close the credential panel. The temporary password will not be shown again."
          confirmLabel="Continue"
          danger
          onCancel={() => setConfirmClose(false)}
          onConfirm={onContinue}
        />
      ) : null}
    </div>
  );
}
