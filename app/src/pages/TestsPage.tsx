import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { TestCase } from "@shared/ipcApi";

export default function TestsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TestCase | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function refresh() {
    if (!currentProjectId) return;
    const res = await window.studio.testCases.list(currentProjectId);
    if (res.ok) setTestCases(res.data);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!currentProjectId) return;
    setError(null);
    const res = await window.studio.testCases.create({ projectId: currentProjectId, title });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate(`/tests/${res.data.id}`);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const res = await window.studio.testCases.delete(pendingDelete.id);
    setIsDeleting(false);
    setPendingDelete(null);
    if (res.ok) await refresh();
  }

  if (!currentProjectId) return <p className="muted">Select a project first.</p>;

  return (
    <div className="stack">
      <div className="row">
        <h1>Test Cases</h1>
        <div className="spacer" />
        <button className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Test"}
        </button>
      </div>

      {showForm && (
        <form className="card row" onSubmit={handleCreate} style={{ alignItems: "flex-end" }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="mini-field" style={{ flex: 1 }}>
            <span className="mini-label">Test Title</span>
            <input
              aria-label="Test title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Search Provider"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="primary">
            Create &amp; Edit
          </button>
        </form>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this test case?"
          message={`"${pendingDelete.title}" and its generation history will be removed. Past execution results are kept for reporting. This can't be undone.`}
          confirmLabel={isDeleting ? "Deleting…" : "Delete"}
          onConfirm={() => void handleDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Suites</th>
              <th>Automation Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {testCases.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => navigate(`/tests/${t.id}`)}>
                <td className="mono">{t.displayId}</td>
                <td>{t.title}</td>
                <td className="muted">{t.priority}</td>
                <td>
                  {t.tags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                    </span>
                  ))}
                  {t.tags.length === 0 && <span className="muted">—</span>}
                </td>
                <td>
                  <span className={`badge ${t.automationStatus === "automated" ? "passed" : "neutral"}`}>{t.automationStatus}</span>
                </td>
                <td>
                  <button
                    className="ghost danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(t);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {testCases.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No test cases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
