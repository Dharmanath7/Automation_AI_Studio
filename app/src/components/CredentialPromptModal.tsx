import { useState } from "react";
import type { Environment } from "@shared/ipcApi";
import { labelForField, isSecretField, type CredentialRef } from "@/lib/credentialRefs";

/**
 * Asks for whatever login details a test needs, in plain language, right
 * when they're actually needed (before Run/Try It) — instead of making the
 * person set up a "Credential Vault profile" ahead of time. Values are
 * still saved encrypted via the same credentials service underneath; this
 * is just a friendlier front door to it, asked once per field.
 */
export function CredentialPromptModal({
  projectId,
  environment,
  refs,
  onCancel,
  onReady,
}: {
  projectId: string;
  environment: Environment;
  refs: CredentialRef[];
  onCancel: () => void;
  onReady: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolveProfileId(profileKey: string): Promise<string | null> {
    const profilesRes = await window.studio.credentials.listProfiles(projectId);
    if (!profilesRes.ok) return null;

    if (profileKey === "default") {
      if (environment.defaultCredentialProfileId) return environment.defaultCredentialProfileId;
      const createRes = await window.studio.credentials.createProfile(projectId, `${environment.name} details`);
      if (!createRes.ok) return null;
      const linkRes = await window.studio.environments.setCredentialProfile(environment.id, createRes.data.id);
      if (!linkRes.ok) return null;
      return createRes.data.id;
    }

    const named = profilesRes.data.find((p) => p.name.toLowerCase() === profileKey.toLowerCase());
    if (named) return named.id;
    const createRes = await window.studio.credentials.createProfile(projectId, profileKey);
    return createRes.ok ? createRes.data.id : null;
  }

  async function handleSave() {
    for (const ref of refs) {
      if (!values[ref.key]?.trim()) {
        setError(`Please fill in ${labelForField(ref.field)}.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const profileIds = new Map<string, string>();
    for (const ref of refs) {
      let profileId = profileIds.get(ref.profileKey);
      if (!profileId) {
        const resolved = await resolveProfileId(ref.profileKey);
        if (!resolved) {
          setBusy(false);
          setError("Couldn't save these details — please try again.");
          return;
        }
        profileId = resolved;
        profileIds.set(ref.profileKey, profileId);
      }
      const res = await window.studio.credentials.setField(profileId, ref.field, values[ref.key], isSecretField(ref.field));
      if (!res.ok) {
        setBusy(false);
        setError(res.error);
        return;
      }
    }
    setBusy(false);
    onReady();
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>A few details needed</h3>
        <p className="muted" style={{ fontSize: 13.5 }}>
          This test needs the following before it can run. You only need to enter these once — they're saved
          securely for next time.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          {refs.map((ref) => (
            <div className="mini-field" key={ref.key}>
              <span className="mini-label">{labelForField(ref.field)}</span>
              <input
                type={isSecretField(ref.field) ? "password" : "text"}
                autoComplete="off"
                value={values[ref.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [ref.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {error && (
          <div className="error-banner" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void handleSave()} disabled={busy}>
            {busy ? "Saving…" : "Save & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
