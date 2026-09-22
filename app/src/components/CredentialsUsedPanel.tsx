import { useEffect, useMemo, useState } from "react";
import type { TestStep } from "@shared/testModel";
import type { CredentialProfile, CredentialFieldSummary, Environment } from "@shared/ipcApi";

interface CredentialRef {
  key: string; // "profileKey.field", used for React keys / de-dupe
  profileKey: string;
  field: string;
}

function collectCredentialRefs(steps: TestStep[]): CredentialRef[] {
  const refs = new Map<string, CredentialRef>();
  function consider(path: string | undefined) {
    if (!path || !path.startsWith("credentials.")) return;
    const parts = path.split(".");
    if (parts.length < 3) return;
    const profileKey = parts[1];
    const field = parts.slice(2).join(".");
    const key = `${profileKey}.${field}`;
    if (!refs.has(key)) refs.set(key, { key, profileKey, field });
  }
  for (const step of steps) {
    if (step.value?.kind === "variable") consider(step.value.path);
    if (step.assertion?.expected?.kind === "variable") consider(step.assertion.expected.path);
  }
  return Array.from(refs.values());
}

/**
 * Surfaces every `credentials.<profile>.<field>` reference a Test Model
 * uses (most commonly `credentials.default.password`, written automatically
 * when the recorder captures a password field — see docs/SECURITY.md §4)
 * and lets the user resolve + actually set the encrypted value right here,
 * instead of navigating away to Environments & Credentials and back.
 */
export function CredentialsUsedPanel({
  projectId,
  environment,
  steps,
  onEnvironmentUpdated,
}: {
  projectId: string;
  environment: Environment | undefined;
  steps: TestStep[];
  onEnvironmentUpdated?: () => void;
}) {
  const refs = useMemo(() => collectCredentialRefs(steps), [steps]);
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [fieldsByProfile, setFieldsByProfile] = useState<Record<string, CredentialFieldSummary[]>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  async function refresh() {
    const res = await window.studio.credentials.listProfiles(projectId);
    if (!res.ok) return;
    setProfiles(res.data);
    const entries = await Promise.all(
      res.data.map(async (p) => {
        const fieldsRes = await window.studio.credentials.listFields(p.id);
        return [p.id, fieldsRes.ok ? fieldsRes.data : []] as const;
      })
    );
    setFieldsByProfile(Object.fromEntries(entries));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshTick]);

  if (refs.length === 0) return null;

  const defaultProfile = environment?.defaultCredentialProfileId
    ? profiles.find((p) => p.id === environment.defaultCredentialProfileId)
    : undefined;

  return (
    <div className="card">
      <h3>Credentials Used</h3>
      <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
        This test references the values below from the Credential Vault. They're encrypted at rest and never shown
        in full — see docs/SECURITY.md.
      </p>
      <div className="stack" style={{ gap: 14 }}>
        {refs.map((ref) => (
          <CredentialRefRow
            key={ref.key}
            ref_={ref}
            projectId={projectId}
            environment={environment}
            profiles={profiles}
            defaultProfile={defaultProfile}
            fieldsByProfile={fieldsByProfile}
            onChanged={() => {
              setRefreshTick((t) => t + 1);
              onEnvironmentUpdated?.();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CredentialRefRow({
  ref_,
  projectId,
  environment,
  profiles,
  defaultProfile,
  fieldsByProfile,
  onChanged,
}: {
  ref_: CredentialRef;
  projectId: string;
  environment: Environment | undefined;
  profiles: CredentialProfile[];
  defaultProfile: CredentialProfile | undefined;
  fieldsByProfile: Record<string, CredentialFieldSummary[]>;
  onChanged: () => void;
}) {
  const [pickProfileId, setPickProfileId] = useState("");
  const [newProfileName, setNewProfileName] = useState("TST Admin");
  const [fieldValue, setFieldValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDefault = ref_.profileKey === "default";
  const namedProfile = !isDefault ? profiles.find((p) => p.name.toLowerCase() === ref_.profileKey.toLowerCase()) : undefined;
  const targetProfile = isDefault ? defaultProfile : namedProfile;
  const isSecretField = /password|secret|token/i.test(ref_.field);

  if (isDefault && !environment) {
    return (
      <div className="row wrap">
        <code className="mono">{`credentials.${ref_.profileKey}.${ref_.field}`}</code>
        <span className="muted">Select an environment from the top bar to configure this.</span>
      </div>
    );
  }

  if (!targetProfile) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="row wrap">
          <code className="mono">{`credentials.${ref_.profileKey}.${ref_.field}`}</code>
          <span className="badge failed">No profile linked</span>
        </div>
        {isDefault ? (
          <div className="row wrap">
            {profiles.length > 0 && (
              <>
                <select value={pickProfileId} onChange={(e) => setPickProfileId(e.target.value)}>
                  <option value="">Use existing profile…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!pickProfileId || busy}
                  onClick={async () => {
                    if (!environment) return;
                    setBusy(true);
                    setError(null);
                    const res = await window.studio.environments.setCredentialProfile(environment.id, pickProfileId);
                    setBusy(false);
                    if (!res.ok) setError(res.error);
                    else onChanged();
                  }}
                >
                  Use for {environment?.name}
                </button>
                <span className="muted">or</span>
              </>
            )}
            <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} style={{ maxWidth: 160 }} />
            <button
              className="primary"
              disabled={busy || !newProfileName.trim()}
              onClick={async () => {
                if (!environment) return;
                setBusy(true);
                setError(null);
                const createRes = await window.studio.credentials.createProfile(projectId, newProfileName.trim());
                if (!createRes.ok) {
                  setBusy(false);
                  setError(createRes.error);
                  return;
                }
                const linkRes = await window.studio.environments.setCredentialProfile(environment.id, createRes.data.id);
                setBusy(false);
                if (!linkRes.ok) setError(linkRes.error);
                else onChanged();
              }}
            >
              Create profile &amp; use it
            </button>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            No Credential Vault profile named "{ref_.profileKey}" exists in this project yet — add one under
            Environments &amp; Credentials.
          </p>
        )}
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  const fields = fieldsByProfile[targetProfile.id] ?? [];
  const existing = fields.find((f) => f.key === ref_.field);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row wrap">
        <code className="mono">{`credentials.${ref_.profileKey}.${ref_.field}`}</code>
        <span className="muted">→ {targetProfile.name}</span>
        {existing ? (
          <span className="badge passed">{existing.maskedValue}</span>
        ) : (
          <span className="badge failed">Not set</span>
        )}
      </div>
      <div className="row wrap">
        <input
          type={isSecretField && !showValue ? "password" : "text"}
          autoComplete="off"
          placeholder={existing ? "New value (leave blank to keep current)" : `Value for "${ref_.field}"`}
          value={fieldValue}
          onChange={(e) => setFieldValue(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {isSecretField && (
          <button type="button" className="ghost" onClick={() => setShowValue((v) => !v)} title={showValue ? "Hide value" : "Show value"}>
            {showValue ? "Hide" : "Show"}
          </button>
        )}
        <button
          className="primary"
          disabled={busy || !fieldValue}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await window.studio.credentials.setField(targetProfile.id, ref_.field, fieldValue, isSecretField);
            setBusy(false);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setFieldValue("");
            onChanged();
          }}
        >
          {existing ? "Update" : "Save"}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
