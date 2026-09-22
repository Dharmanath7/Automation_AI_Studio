import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "@/state/authStore";
import { useProjectStore } from "@/state/projectStore";

function SoonItem({ label }: { label: string }) {
  return (
    <div style={{ padding: "8px 20px", fontSize: 13.5, color: "#5b6270", display: "flex", justifyContent: "space-between" }}>
      <span>{label}</span>
      <span style={{ fontSize: 10, background: "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: 999 }}>Soon</span>
    </div>
  );
}

export default function AppShell() {
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const { projects, currentProjectId, environments, currentEnvironmentId, loadProjects, selectProject, selectEnvironment } =
    useProjectStore();

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">Automation AI Studio</div>

        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/projects">Projects</NavLink>

        <div className="group-title">Tests</div>
        <NavLink to="/tests">Test Cases</NavLink>
        <SoonItem label="Reusable Flows" />

        <div className="group-title">Create</div>
        <NavLink to="/tests?new=1">Build Test Manually</NavLink>
        <NavLink to="/record">Record Browser</NavLink>
        <SoonItem label="AI Test Builder" />
        <SoonItem label="Screenshot Lab" />

        <div className="group-title">Execution</div>
        <NavLink to="/execution">Run Tests</NavLink>

        <div className="group-title">Reports</div>
        <NavLink to="/reports">Execution History</NavLink>

        <div className="group-title">Project Configuration</div>
        <NavLink to={currentProjectId ? `/projects/${currentProjectId}` : "/projects"}>Environments &amp; Credentials</NavLink>

        <div className="group-title">Tools</div>
        <NavLink to="/runtime">Runtime Manager</NavLink>
        <SoonItem label="Element Inspector" />
        <SoonItem label="Locator Analyzer" />

        <div className="spacer" />
      </nav>

      <div className="main-area">
        <div className="topbar">
          <div className="row" style={{ minWidth: 260 }}>
            <select value={currentProjectId ?? ""} onChange={(e) => void selectProject(e.target.value || null)}>
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ minWidth: 180 }}>
            <select
              value={currentEnvironmentId ?? ""}
              onChange={(e) => selectEnvironment(e.target.value || null)}
              disabled={environments.length === 0}
            >
              <option value="">{environments.length === 0 ? "No environments" : "Select environment…"}</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
          <div className="spacer" />
          <span className="muted">{username}</span>
          <button className="ghost" onClick={() => void handleLogout()}>
            Logout
          </button>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
