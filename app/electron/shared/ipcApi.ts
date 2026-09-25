/**
 * Type-only contract for the window.studio preload bridge. Every function
 * here is implemented in electron/preload.ts and consumed by the renderer;
 * nothing runtime is imported here, so this file is safe on both sides of
 * the process boundary.
 */
import type { Project, CreateProjectInput } from "../services/projectService";
import type { Environment, CreateEnvironmentInput } from "../services/environmentService";
import type { CredentialProfile, CredentialFieldSummary } from "../services/credentialService";
import type { TestCase, CreateTestCaseInput } from "../services/testCaseService";
import type { TestModel, TestStep } from "./testModel";
import type { RecorderEvent, RecorderBrowser } from "../services/recorder/recorderService";
import type { DashboardAnalytics } from "../services/analyticsService";
import type { WriteOutcome, AutomationMapping } from "../services/codegen/generationService";
import type { RunRequest, ExecutionSummary, ExecutionDetail } from "../services/execution/executionService";
import type { ExecutionEvent, RuntimeCheckResult } from "../services/execution/ExecutionAdapter";
import type { PreviewEvent, PreviewEnv } from "../services/preview/previewService";

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export interface LoginResponse {
  sessionId: string;
  expiresAt: string;
  username: string;
  role: string;
}

export interface BrowserConfig {
  id: string;
  name: string;
  engine: string;
  is_builtin: number;
  is_available: number;
}

export interface FrameworkConfig {
  id: string;
  language: string;
  framework: string;
  test_runner: string;
  style: string;
  is_available: number;
}

export interface StudioApi {
  auth: {
    login(username: string, password: string, rememberMe: boolean): Promise<Envelope<LoginResponse>>;
    logout(): Promise<Envelope<{ loggedOut: boolean }>>;
    me(): Promise<Envelope<{ username: string; role: string }>>;
    changePassword(newPassword: string): Promise<Envelope<{ changed: boolean }>>;
  };
  projects: {
    list(): Promise<Envelope<Project[]>>;
    create(input: CreateProjectInput): Promise<Envelope<Project>>;
    get(id: string): Promise<Envelope<Project | null>>;
  };
  environments: {
    list(projectId: string): Promise<Envelope<Environment[]>>;
    create(input: CreateEnvironmentInput): Promise<Envelope<Environment>>;
    setCredentialProfile(environmentId: string, credentialProfileId: string | null): Promise<Envelope<Environment>>;
  };
  credentials: {
    listProfiles(projectId: string): Promise<Envelope<CredentialProfile[]>>;
    createProfile(projectId: string, name: string): Promise<Envelope<CredentialProfile>>;
    setField(profileId: string, key: string, value: string, isSecret?: boolean): Promise<Envelope<{ saved: boolean }>>;
    listFields(profileId: string): Promise<Envelope<CredentialFieldSummary[]>>;
    deleteProfile(profileId: string): Promise<Envelope<{ deleted: boolean }>>;
  };
  testCases: {
    list(projectId: string): Promise<Envelope<TestCase[]>>;
    create(input: CreateTestCaseInput): Promise<Envelope<TestCase>>;
    get(id: string): Promise<Envelope<TestCase | null>>;
    saveModel(testCaseId: string, model: TestModel): Promise<Envelope<TestCase>>;
    delete(id: string): Promise<Envelope<{ deleted: boolean }>>;
  };
  codegen: {
    generate(testCaseId: string, forcePaths?: string[]): Promise<Envelope<WriteOutcome>>;
    getMapping(testCaseId: string): Promise<Envelope<AutomationMapping | null>>;
    readFile(projectId: string, relativePath: string): Promise<Envelope<{ content: string }>>;
  };
  execution: {
    run(request: Omit<RunRequest, "triggeredByUserId">): Promise<Envelope<{ executionId: string; result: unknown }>>;
    list(projectId: string): Promise<Envelope<ExecutionSummary[]>>;
    get(executionId: string): Promise<Envelope<ExecutionDetail | null>>;
    onEvent(cb: (event: ExecutionEvent) => void): () => void;
  };
  runtime: {
    check(projectId: string): Promise<Envelope<RuntimeCheckResult[]>>;
    lastCheck(): Promise<Envelope<RuntimeCheckResult[]>>;
  };
  reference: {
    listBrowsers(): Promise<Envelope<BrowserConfig[]>>;
    listFrameworks(): Promise<Envelope<FrameworkConfig[]>>;
  };
  dialog: {
    selectDirectory(): Promise<Envelope<{ path: string | null }>>;
  };
  recorder: {
    start(baseUrl: string, browser: RecorderBrowser): Promise<Envelope<{ recordingId: string }>>;
    stop(recordingId: string): Promise<Envelope<{ steps: TestStep[] }>>;
    onEvent(cb: (event: RecorderEvent) => void): () => void;
  };
  /** The recorder companion toolbar window's own, unauthenticated actions — see registerIpc.ts. */
  recorderToolbar: {
    requestStop(recordingId: string): Promise<Envelope<{ recordingId: string }>>;
    insertRandomValue(recordingId: string): Promise<Envelope<{ ok: boolean; reason?: string }>>;
  };
  /** "Try It in a Browser" — dry-runs a test case's steps against a real, visible browser so a guessed locator is verified rather than assumed. */
  preview: {
    start(steps: TestStep[], env: PreviewEnv, browser: RecorderBrowser): Promise<Envelope<{ previewId: string }>>;
    stop(previewId: string): Promise<Envelope<{ stopped: boolean }>>;
    onEvent(cb: (event: PreviewEvent) => void): () => void;
  };
  analytics: {
    dashboard(projectId: string): Promise<Envelope<DashboardAnalytics>>;
  };
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}

// Convenience re-exports so the renderer can pull every DTO it needs from
// this one module instead of reaching into electron/services directly.
export type { Project, CreateProjectInput } from "../services/projectService";
export type { Environment, CreateEnvironmentInput } from "../services/environmentService";
export type { CredentialProfile, CredentialFieldSummary } from "../services/credentialService";
export type { TestCase, CreateTestCaseInput } from "../services/testCaseService";
export type { WriteOutcome, AutomationMapping } from "../services/codegen/generationService";
export type { RunRequest, ExecutionSummary, ExecutionDetail, TriggerType } from "../services/execution/executionService";
export type { ExecutionEvent, RuntimeCheckResult, ExecutionResult, NormalizedTestResult } from "../services/execution/ExecutionAdapter";
export type { DashboardAnalytics, ExecutionTrendPoint } from "../services/analyticsService";
export type { RecorderBrowser } from "../services/recorder/recorderService";
