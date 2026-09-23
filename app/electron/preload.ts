import { contextBridge, ipcRenderer } from "electron";
import type { StudioApi, Envelope } from "./shared/ipcApi";

let sessionId: string | null = null;

async function invoke<T>(channel: string, payload: Record<string, unknown> = {}): Promise<Envelope<T>> {
  return ipcRenderer.invoke(channel, { sessionId, ...payload }) as Promise<Envelope<T>>;
}

// No sessionId — for the recorder toolbar window's unauthenticated actions
// only (see the comment on their handlers in registerIpc.ts).
async function invokePublic<T>(channel: string, payload: Record<string, unknown> = {}): Promise<Envelope<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Envelope<T>>;
}

const api: StudioApi = {
  auth: {
    async login(username, password, rememberMe) {
      const result = await ipcRenderer.invoke("auth:login", { username, password, rememberMe });
      if (result.ok) sessionId = result.data.sessionId;
      return result;
    },
    async logout() {
      const result = await invoke("auth:logout");
      sessionId = null;
      return result as Envelope<{ loggedOut: boolean }>;
    },
    me: () => invoke("auth:me"),
    changePassword: (newPassword) => invoke("auth:changePassword", { newPassword }),
  },
  projects: {
    list: () => invoke("projects:list"),
    create: (input) => invoke("projects:create", { input }),
    get: (id) => invoke("projects:get", { id }),
  },
  environments: {
    list: (projectId) => invoke("environments:list", { projectId }),
    create: (input) => invoke("environments:create", { input }),
    setCredentialProfile: (environmentId, credentialProfileId) =>
      invoke("environments:setCredentialProfile", { environmentId, credentialProfileId }),
  },
  credentials: {
    listProfiles: (projectId) => invoke("credentials:listProfiles", { projectId }),
    createProfile: (projectId, name) => invoke("credentials:createProfile", { projectId, name }),
    setField: (profileId, key, value, isSecret) => invoke("credentials:setField", { profileId, key, value, isSecret }),
    listFields: (profileId) => invoke("credentials:listFields", { profileId }),
    deleteProfile: (profileId) => invoke("credentials:deleteProfile", { profileId }),
  },
  testCases: {
    list: (projectId) => invoke("testCases:list", { projectId }),
    create: (input) => invoke("testCases:create", { input }),
    get: (id) => invoke("testCases:get", { id }),
    saveModel: (testCaseId, model) => invoke("testCases:saveModel", { testCaseId, model }),
    delete: (id) => invoke("testCases:delete", { id }),
  },
  codegen: {
    generate: (testCaseId, forcePaths) => invoke("codegen:generate", { testCaseId, forcePaths }),
    getMapping: (testCaseId) => invoke("codegen:getMapping", { testCaseId }),
    readFile: (projectId, relativePath) => invoke("codegen:readFile", { projectId, relativePath }),
  },
  execution: {
    run: (request) => invoke("execution:run", { request }),
    list: (projectId) => invoke("execution:list", { projectId }),
    get: (executionId) => invoke("execution:get", { executionId }),
    onEvent: (cb) => {
      const listener = (_evt: unknown, event: unknown) => cb(event as never);
      ipcRenderer.on("execution:event", listener);
      return () => ipcRenderer.removeListener("execution:event", listener);
    },
  },
  runtime: {
    check: (projectId) => invoke("runtime:check", { projectId }),
    lastCheck: () => invoke("runtime:lastCheck"),
  },
  reference: {
    listBrowsers: () => invoke("browsers:list"),
    listFrameworks: () => invoke("frameworks:list"),
  },
  dialog: {
    selectDirectory: () => invoke("dialog:selectDirectory"),
  },
  recorder: {
    start: (baseUrl, browser) => invoke("recorder:start", { baseUrl, browser }),
    stop: (recordingId) => invoke("recorder:stop", { recordingId }),
    onEvent: (cb) => {
      const listener = (_evt: unknown, event: unknown) => cb(event as never);
      ipcRenderer.on("recorder:event", listener);
      return () => ipcRenderer.removeListener("recorder:event", listener);
    },
  },
  recorderToolbar: {
    requestStop: (recordingId) => invokePublic("recorderToolbar:requestStop", { recordingId }),
    insertRandomValue: (recordingId) => invokePublic("recorderToolbar:insertRandomValue", { recordingId }),
  },
  analytics: {
    dashboard: (projectId) => invoke("analytics:dashboard", { projectId }),
  },
};

contextBridge.exposeInMainWorld("studio", api);
