import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/state/authStore";

/**
 * UX convenience only — the real auth boundary is the main process
 * (every IPC handler validates the session itself). See docs/SECURITY.md §1.
 */
export default function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
