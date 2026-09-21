import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, loadProjects, selectProject } = useProjectStore();
  const [showForm, setShowForm] = useState(projects.length === 0);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [projectDirectory, setProjectDirectory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function browse() {
    const res = await window.studio.dialog.selectDirectory();
    if (res.ok && res.data.path) setProjectDirectory(res.data.path);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsBusy(true);
    const res = await window.studio.projects.create({
      name,
      code,
      description: description || undefined,
      projectDirectory,
      appType: "web",
      language: "python",
      framework: "playwright",
      testRunner: "pytest",
      style: "page_object_model",
    });
    setIsBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await loadProjects();
    await selectProject(res.data.id);
    navigate(`/projects/${res.data.id}`);
  }

  return (
    <div className="stack">
      <div className="row">
        <h1>Projects</h1>
        <div className="spacer" />
        <button className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Project"}
        </button>
      </div>

      {showForm && (
        <form className="card" onSubmit={handleSubmit}>
          <h2>Create Project</h2>
          {error && (
            <div className="error-banner" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}
          <div className="row wrap">
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label>Project Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="symplr Directory" required />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Project Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SYMPLR" required />
            </div>
          </div>
          <div className="field">
            <label>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label>Project Directory (where generated automation code will live)</label>
            <div className="row">
              <input
                value={projectDirectory}
                onChange={(e) => setProjectDirectory(e.target.value)}
                placeholder="C:\Automation\symplr-directory"
                required
              />
              <button type="button" onClick={() => void browse()}>
                Browse…
              </button>
            </div>
          </div>
          <div className="row wrap muted" style={{ fontSize: 12, marginBottom: 14 }}>
            <span>Language: Python</span>
            <span>·</span>
            <span>Framework: Playwright</span>
            <span>·</span>
            <span>Runner: Pytest</span>
            <span>·</span>
            <span>Style: Page Object Model</span>
          </div>
          <button type="submit" className="primary" disabled={isBusy}>
            {isBusy ? "Creating…" : "Create Project"}
          </button>
        </form>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Stack</th>
              <th>Directory</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                <td>{p.name}</td>
                <td className="mono">{p.code}</td>
                <td className="muted">
                  {p.language} / {p.framework} / {p.testRunner}
                </td>
                <td className="mono muted">{p.projectDirectory}</td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
