import { ipcMain, dialog, type BrowserWindow } from "electron";
import type { z } from "zod";
import { getDb } from "../db";
import { validateSession, createSession, destroySession, type SessionUser } from "../services/sessionService";
import { login, changePassword } from "../services/authService";
import { createProject, listProjects, getProject } from "../services/projectService";
import { createEnvironment, listEnvironments, setDefaultCredentialProfile } from "../services/environmentService";
import {
  createCredentialProfile,
  listCredentialProfiles,
  setCredentialField,
  listCredentialFields,
  deleteCredentialProfile,
} from "../services/credentialService";
import { createTestCase, listTestCases, getTestCase, saveTestModel, deleteTestCase } from "../services/testCaseService";
import { PlaywrightPythonPytestGenerator } from "../services/codegen/adapters/PlaywrightPythonPytestGenerator";
import { writeGeneratedCode, getAutomationMapping, readProjectFile } from "../services/codegen/generationService";
import { runExecution, listExecutions, getExecution } from "../services/execution/executionService";
import { checkAndCacheRuntime, getLastRuntimeCheck } from "../services/runtimeService";
import { startRecording, stopRecording } from "../services/recorder/recorderService";
import { getDashboardAnalytics } from "../services/analyticsService";
import { getLogger } from "../services/logger";
import type { TestModel } from "../shared/testModel";
import * as schemas from "./schemas";

const logger = getLogger("db");

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): Envelope<T> {
  return { ok: true, data };
}
function fail(error: string): Envelope<never> {
  return { ok: false, error };
}

function handlePublic<S extends z.ZodTypeAny>(channel: string, schema: S, fn: (data: z.infer<S>) => unknown | Promise<unknown>) {
  ipcMain.handle(channel, async (_evt, raw) => {
    try {
      const parsed = schema.parse(raw);
      const data = await fn(parsed);
      return ok(data);
    } catch (err) {
      logger.warn({ channel, err: errorMessage(err) }, "ipc handler error");
      return fail(errorMessage(err));
    }
  });
}

function handleAuthed<S extends z.ZodTypeAny>(
  channel: string,
  schema: S,
  fn: (data: z.infer<S>, session: SessionUser) => unknown | Promise<unknown>
) {
  ipcMain.handle(channel, async (_evt, raw) => {
    try {
      const parsed = schema.parse(raw);
      const session = validateSession(getDb(), (parsed as { sessionId: string }).sessionId);
      if (!session) return fail("Not authenticated. Please log in again.");
      const data = await fn(parsed, session);
      return ok(data);
    } catch (err) {
      logger.warn({ channel, err: errorMessage(err) }, "ipc handler error");
      return fail(errorMessage(err));
    }
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ---- Auth --------------------------------------------------------------
  handlePublic("auth:login", schemas.authLoginSchema, async ({ username, password, rememberMe }) => {
    const db = getDb();
    const result = await login(db, username, password);
    // Throwing here (instead of returning a nested {ok:false}) keeps this
    // channel's envelope single-level, like every other channel — the
    // preload only ever needs to check the outer `result.ok` before reading
    // `result.data.sessionId`. A prior version double-wrapped this and a
    // failed login silently clobbered a valid session (caught via the CDP
    // smoke test in tests/e2e — see git history).
    if (!result.ok) throw new Error(result.error);
    const session = createSession(db, result.userId, !!rememberMe);
    return { sessionId: session.sessionId, expiresAt: session.expiresAt, username: result.username, role: result.role };
  });

  handleAuthed("auth:logout", schemas.authLogoutSchema, ({ sessionId }) => {
    destroySession(getDb(), sessionId);
    return { loggedOut: true };
  });

  handleAuthed("auth:me", schemas.authMeSchema, (_data, session) => ({
    username: session.username,
    role: session.role,
  }));

  handleAuthed("auth:changePassword", schemas.authChangePasswordSchema, async ({ newPassword }, session) => {
    await changePassword(getDb(), session.userId, newPassword);
    return { changed: true };
  });

  // ---- Projects ------------------------------------------------------------
  handleAuthed("projects:list", schemas.projectsListSchema, () => listProjects(getDb()));
  handleAuthed("projects:create", schemas.projectsCreateSchema, ({ input }) => createProject(getDb(), input));
  handleAuthed("projects:get", schemas.projectsGetSchema, ({ id }) => getProject(getDb(), id));

  // ---- Environments --------------------------------------------------------
  handleAuthed("environments:list", schemas.environmentsListSchema, ({ projectId }) => listEnvironments(getDb(), projectId));
  handleAuthed("environments:create", schemas.environmentsCreateSchema, ({ input }) => createEnvironment(getDb(), input));
  handleAuthed("environments:setCredentialProfile", schemas.environmentsSetCredentialProfileSchema, ({ environmentId, credentialProfileId }) =>
    setDefaultCredentialProfile(getDb(), environmentId, credentialProfileId)
  );

  // ---- Credential Vault ------------------------------------------------------
  handleAuthed("credentials:listProfiles", schemas.credentialsListProfilesSchema, ({ projectId }) =>
    listCredentialProfiles(getDb(), projectId)
  );
  handleAuthed("credentials:createProfile", schemas.credentialsCreateProfileSchema, ({ projectId, name }) =>
    createCredentialProfile(getDb(), projectId, name)
  );
  handleAuthed("credentials:setField", schemas.credentialsSetFieldSchema, ({ profileId, key, value, isSecret }) => {
    setCredentialField(getDb(), profileId, key, value, isSecret ?? true);
    return { saved: true };
  });
  handleAuthed("credentials:listFields", schemas.credentialsListFieldsSchema, ({ profileId }) =>
    listCredentialFields(getDb(), profileId)
  );
  handleAuthed("credentials:deleteProfile", schemas.credentialsDeleteProfileSchema, ({ profileId }) => {
    deleteCredentialProfile(getDb(), profileId);
    return { deleted: true };
  });

  // ---- Test cases ------------------------------------------------------------
  handleAuthed("testCases:list", schemas.testCasesListSchema, ({ projectId }) => listTestCases(getDb(), projectId));
  handleAuthed("testCases:create", schemas.testCasesCreateSchema, ({ input }) => createTestCase(getDb(), input));
  handleAuthed("testCases:get", schemas.testCasesGetSchema, ({ id }) => getTestCase(getDb(), id));
  handleAuthed("testCases:delete", schemas.testCasesDeleteSchema, ({ id }) => {
    deleteTestCase(getDb(), id);
    return { deleted: true };
  });
  handleAuthed("testCases:saveModel", schemas.testCasesSaveModelSchema, ({ testCaseId, model }) => {
    const db = getDb();
    const knownBaseUrls = listEnvironments(db, model.projectId).map((e) => e.baseUrl);
    return saveTestModel(db, testCaseId, model as unknown as TestModel, knownBaseUrls);
  });

  // ---- Code generation ---------------------------------------------------
  handleAuthed("codegen:generate", schemas.codegenGenerateSchema, ({ testCaseId, forcePaths }) => {
    const db = getDb();
    const testCase = getTestCase(db, testCaseId);
    if (!testCase) throw new Error("Test case not found.");
    const project = getProject(db, testCase.projectId);
    if (!project) throw new Error("Project not found.");
    const generated = PlaywrightPythonPytestGenerator.generate(testCase.testModel, {
      projectDirectory: project.projectDirectory,
      projectCode: project.code,
      existingPageObjectNames: [],
    });
    return writeGeneratedCode(db, project, testCaseId, generated, { forcePaths });
  });
  handleAuthed("codegen:getMapping", schemas.codegenGetMappingSchema, ({ testCaseId }) =>
    getAutomationMapping(getDb(), testCaseId)
  );
  handleAuthed("codegen:readFile", schemas.codegenReadFileSchema, ({ projectId, relativePath }) => {
    const project = getProject(getDb(), projectId);
    if (!project) throw new Error("Project not found.");
    return { content: readProjectFile(project, relativePath) };
  });

  // ---- Execution -----------------------------------------------------------
  handleAuthed("execution:run", schemas.executionRunSchema, async ({ request }, session) => {
    return runExecution(getDb(), { ...request, triggeredByUserId: session.userId }, (event) => {
      mainWindow.webContents.send("execution:event", event);
    });
  });
  handleAuthed("execution:list", schemas.executionListSchema, ({ projectId }) => listExecutions(getDb(), projectId));
  handleAuthed("execution:get", schemas.executionGetSchema, ({ executionId }) => getExecution(getDb(), executionId));

  // ---- Runtime Manager -------------------------------------------------------
  handleAuthed("runtime:check", schemas.runtimeCheckSchema, async ({ projectId }) => {
    const project = getProject(getDb(), projectId);
    if (!project) throw new Error("Project not found.");
    return checkAndCacheRuntime(getDb(), project.projectDirectory);
  });
  handleAuthed("runtime:lastCheck", schemas.runtimeLastCheckSchema, () => getLastRuntimeCheck(getDb()));

  // ---- Reference data --------------------------------------------------------
  handleAuthed("browsers:list", schemas.browsersListSchema, () =>
    getDb().prepare("SELECT * FROM browser_configs ORDER BY name").all()
  );
  handleAuthed("frameworks:list", schemas.frameworksListSchema, () =>
    getDb().prepare("SELECT * FROM framework_configs ORDER BY language, framework").all()
  );

  // ---- Analytics -------------------------------------------------------------
  handleAuthed("analytics:dashboard", schemas.analyticsDashboardSchema, ({ projectId }) =>
    getDashboardAnalytics(getDb(), projectId)
  );

  // ---- Browser recorder ----------------------------------------------------
  handleAuthed("recorder:start", schemas.recorderStartSchema, async ({ baseUrl, browser }) => {
    const recordingId = await startRecording({
      baseUrl,
      browser,
      onEvent: (event) => mainWindow.webContents.send("recorder:event", event),
    });
    return { recordingId };
  });
  handleAuthed("recorder:stop", schemas.recorderStopSchema, async ({ recordingId }) => {
    const steps = await stopRecording(recordingId);
    return { steps };
  });

  // ---- Native dialogs ---------------------------------------------------
  handleAuthed("dialog:selectDirectory", schemas.authMeSchema, async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });
}
