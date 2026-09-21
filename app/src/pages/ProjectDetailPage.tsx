import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import type { Environment, CredentialProfile, CredentialFieldSummary } from "@shared/ipcApi";
import { useProjectStore } from "@/state/projectStore";

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));

  if (!projectId || !project) {
    return <p className="muted">Select a project first.</p>;
  }

  return (
    <div className="stack">
      <div>
        <h1>{project.name}</h1>
        <p className="muted">
          {project.language} · {project.framework} · {project.testRunner} · {project.style} · {project.projectDirectory}
        </p>
      </div>
      <EnvironmentsSection projectId={projectId} />
      <CredentialsSection projectId={projectId} />
    </div>
  );
}

function EnvironmentsSection({ projectId }: { projectId: string }) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [customVars, setCustomVars] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadEnvironments = useProjectStore((s) => s.selectProject);

  async function refresh() {
    const res = await window.studio.environments.list(projectId);
    if (res.ok) setEnvironments(res.data);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const customVariables: Record<string, string> = {};
    for (const line of customVars.split("\n")) {
      const [k, ...rest] = line.split("=");
      if (k && rest.length > 0) customVariables[k.trim()] = rest.join("=").trim();
    }
    const res = await window.studio.environments.create({ projectId, name, baseUrl, apiUrl: apiUrl || undefined, customVariables });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setBaseUrl("");
    setApiUrl("");
    setCustomVars("");
    setShowForm(false);
    await refresh();
    await loadEnvironments(projectId); // refresh top-bar environment selector too
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Environments</h2>
        <div className="spacer" />
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add Environment"}</button>
      </div>

      {showForm && (
        <form className="stack" onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="row wrap">
            <div className="field" style={{ flex: 1, minWidth: 120 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="TST" required />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label>Base URL</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://go.tst-example.com" required />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label>API URL (optional)</label>
              <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.tst-example.com" />
            </div>
          </div>
          <div className="field">
            <label>Custom Variables (one KEY=value per line)</label>
            <textarea rows={3} value={customVars} onChange={(e) => setCustomVars(e.target.value)} placeholder={"TENANT=NYP\nFEATURE_FLAG=true"} />
          </div>
          <button type="submit" className="primary" style={{ alignSelf: "flex-start" }}>
            Save Environment
          </button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Base URL</th>
            <th>API URL</th>
          </tr>
        </thead>
        <tbody>
          {environments.map((env) => (
            <tr key={env.id}>
              <td>{env.name}</td>
              <td className="mono">{env.baseUrl}</td>
              <td className="mono muted">{env.apiUrl ?? "—"}</td>
            </tr>
          ))}
          {environments.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No environments yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CredentialsSection({ projectId }: { projectId: string }) {
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [fields, setFields] = useState<CredentialFieldSummary[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [fieldKey, setFieldKey] = useState("username");
  const [fieldValue, setFieldValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refreshProfiles() {
    const res = await window.studio.credentials.listProfiles(projectId);
    if (res.ok) {
      setProfiles(res.data);
      if (!selectedProfileId && res.data.length > 0) setSelectedProfileId(res.data[0].id);
    }
  }

  async function refreshFields(profileId: string) {
    const res = await window.studio.credentials.listFields(profileId);
    if (res.ok) setFields(res.data);
  }

  useEffect(() => {
    void refreshProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (selectedProfileId) void refreshFields(selectedProfileId);
    else setFields([]);
  }, [selectedProfileId]);

  async function createProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await window.studio.credentials.createProfile(projectId, newProfileName);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNewProfileName("");
    await refreshProfiles();
    setSelectedProfileId(res.data.id);
  }

  async function saveField(e: FormEvent) {
    e.preventDefault();
    if (!selectedProfileId) return;
    setError(null);
    const res = await window.studio.credentials.setField(selectedProfileId, fieldKey, fieldValue, true);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFieldValue("");
    await refreshFields(selectedProfileId);
  }

  return (
    <div className="card">
      <h2>Credential Vault</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 12.5 }}>
        Secrets are encrypted (AES-256-GCM) and never shown, logged, or written into generated code. See docs/SECURITY.md.
      </p>
      {error && (
        <div className="error-banner" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 220 }}>
          <h3>Profiles</h3>
          <div className="stack" style={{ gap: 4, marginBottom: 12 }}>
            {profiles.map((p) => (
              <button
                key={p.id}
                className={p.id === selectedProfileId ? "primary" : "ghost"}
                style={{ textAlign: "left" }}
                onClick={() => setSelectedProfileId(p.id)}
              >
                {p.name}
              </button>
            ))}
            {profiles.length === 0 && <p className="muted">No profiles yet.</p>}
          </div>
          <form className="row" onSubmit={createProfile}>
            <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder="TST Admin" required />
            <button type="submit">Add</button>
          </form>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <h3>Fields</h3>
          {selectedProfileId ? (
            <>
              <table style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key}>
                      <td className="mono">{f.key}</td>
                      <td className="mono">{f.maskedValue}</td>
                      <td className="muted">{new Date(f.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {fields.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No fields yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <form className="row" onSubmit={saveField}>
                <select value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} style={{ maxWidth: 160 }}>
                  <option value="username">username</option>
                  <option value="password">password</option>
                  <option value="api_token">api_token</option>
                  <option value="client_id">client_id</option>
                  <option value="client_secret">client_secret</option>
                </select>
                <input
                  type="password"
                  value={fieldValue}
                  onChange={(e) => setFieldValue(e.target.value)}
                  placeholder="Value"
                  required
                />
                <button type="submit" className="primary">
                  Save
                </button>
              </form>
            </>
          ) : (
            <p className="muted">Select or create a profile.</p>
          )}
        </div>
      </div>
    </div>
  );
}
