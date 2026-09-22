import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/state/authStore";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isBusy, error } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const success = await login(username, password, rememberMe);
    if (success) navigate("/dashboard");
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="logo-mark">AI</div>
        <div className="brand">Automation AI Studio</div>
        <div className="subtitle">Intelligent end-to-end QA automation</div>

        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="field row">
          <input
            id="rememberMe"
            type="checkbox"
            style={{ width: "auto" }}
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <label htmlFor="rememberMe" style={{ margin: 0, textTransform: "none", fontWeight: 400 }}>
            Remember me
          </label>
        </div>
        <button type="submit" className="primary" style={{ width: "100%" }} disabled={isBusy}>
          {isBusy ? "Signing in…" : "Login"}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 16, textAlign: "center" }}>
          Local MVP bootstrap account: <span className="mono">ADMIN / ADMIN</span>
        </p>
      </form>
    </div>
  );
}
