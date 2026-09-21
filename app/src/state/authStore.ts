import { create } from "zustand";

interface AuthState {
  username: string | null;
  role: string | null;
  isAuthenticated: boolean;
  error: string | null;
  isBusy: boolean;
  login: (username: string, password: string, rememberMe: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  username: null,
  role: null,
  isAuthenticated: false,
  error: null,
  isBusy: false,

  async login(username, password, rememberMe) {
    set({ isBusy: true, error: null });
    const res = await window.studio.auth.login(username, password, rememberMe);
    if (!res.ok) {
      set({ isBusy: false, error: res.error });
      return false;
    }
    set({ isBusy: false, username: res.data.username, role: res.data.role, isAuthenticated: true, error: null });
    return true;
  },

  async logout() {
    await window.studio.auth.logout();
    set({ username: null, role: null, isAuthenticated: false });
  },
}));
