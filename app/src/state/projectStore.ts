import { create } from "zustand";
import type { Project, Environment } from "@shared/ipcApi";

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  environments: Environment[];
  currentEnvironmentId: string | null;
  loadProjects: () => Promise<void>;
  selectProject: (id: string | null) => Promise<void>;
  selectEnvironment: (id: string | null) => void;
  currentProject: () => Project | null;
  currentEnvironment: () => Environment | null;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  environments: [],
  currentEnvironmentId: null,

  async loadProjects() {
    const res = await window.studio.projects.list();
    if (res.ok) {
      set({ projects: res.data });
      if (!get().currentProjectId && res.data.length > 0) {
        await get().selectProject(res.data[0].id);
      }
    }
  },

  async selectProject(id) {
    set({ currentProjectId: id, environments: [], currentEnvironmentId: null });
    if (!id) return;
    const res = await window.studio.environments.list(id);
    if (res.ok) {
      set({ environments: res.data });
      const project = get().projects.find((p) => p.id === id);
      const preferred = project?.defaultEnvironmentId ?? res.data[0]?.id ?? null;
      set({ currentEnvironmentId: preferred });
    }
  },

  selectEnvironment(id) {
    set({ currentEnvironmentId: id });
  },

  currentProject() {
    const { projects, currentProjectId } = get();
    return projects.find((p) => p.id === currentProjectId) ?? null;
  },

  currentEnvironment() {
    const { environments, currentEnvironmentId } = get();
    return environments.find((e) => e.id === currentEnvironmentId) ?? null;
  },
}));
