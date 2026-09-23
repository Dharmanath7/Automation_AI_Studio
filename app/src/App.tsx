import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/AppShell";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ProjectsPage from "@/pages/ProjectsPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import TestsPage from "@/pages/TestsPage";
import TestEditorPage from "@/pages/TestEditorPage";
import RecorderPage from "@/pages/RecorderPage";
import RecorderToolbarPage from "@/pages/RecorderToolbarPage";
import ExecutionPage from "@/pages/ExecutionPage";
import ReportsPage from "@/pages/ReportsPage";
import RuntimePage from "@/pages/RuntimePage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Loaded in its own small companion BrowserWindow (see
          registerIpc.ts's openToolbarWindow), not inside the main app shell
          — it doesn't need a session, sidebar, or top bar, just two
          buttons. */}
      <Route path="/recorder-toolbar" element={<RecorderToolbarPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/tests" element={<TestsPage />} />
          <Route path="/tests/:testCaseId" element={<TestEditorPage />} />
          <Route path="/record" element={<RecorderPage />} />
          <Route path="/execution" element={<ExecutionPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:executionId" element={<ReportsPage />} />
          <Route path="/runtime" element={<RuntimePage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
