import { z } from "zod";

const sessionField = { sessionId: z.string().min(1) };

export const authLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});
export const authLogoutSchema = z.object({ ...sessionField });
export const authMeSchema = z.object({ ...sessionField });
export const authChangePasswordSchema = z.object({ ...sessionField, newPassword: z.string().min(4) });

export const projectsListSchema = z.object({ ...sessionField });
export const projectsCreateSchema = z.object({
  ...sessionField,
  input: z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    description: z.string().optional(),
    appType: z.enum(["web", "api", "web_api"]).optional(),
    projectDirectory: z.string().min(1),
    gitRepositoryUrl: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
    testRunner: z.string().optional(),
    style: z.string().optional(),
    defaultBrowserId: z.string().optional(),
  }),
});
export const projectsGetSchema = z.object({ ...sessionField, id: z.string().min(1) });

export const environmentsListSchema = z.object({ ...sessionField, projectId: z.string().min(1) });
export const environmentsSetCredentialProfileSchema = z.object({
  ...sessionField,
  environmentId: z.string().min(1),
  credentialProfileId: z.string().min(1).nullable(),
});
export const environmentsCreateSchema = z.object({
  ...sessionField,
  input: z.object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    baseUrl: z.string().min(1),
    apiUrl: z.string().optional(),
    defaultCredentialProfileId: z.string().optional(),
    defaultBrowserId: z.string().optional(),
    timeoutMs: z.number().optional(),
    customVariables: z.record(z.string()).optional(),
  }),
});

export const credentialsListProfilesSchema = z.object({ ...sessionField, projectId: z.string().min(1) });
export const credentialsCreateProfileSchema = z.object({
  ...sessionField,
  projectId: z.string().min(1),
  name: z.string().min(1),
});
export const credentialsSetFieldSchema = z.object({
  ...sessionField,
  profileId: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
  isSecret: z.boolean().optional(),
});
export const credentialsListFieldsSchema = z.object({ ...sessionField, profileId: z.string().min(1) });
export const credentialsDeleteProfileSchema = z.object({ ...sessionField, profileId: z.string().min(1) });

export const testCasesListSchema = z.object({ ...sessionField, projectId: z.string().min(1) });
export const testCasesCreateSchema = z.object({
  ...sessionField,
  input: z.object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    preconditions: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    feature: z.string().optional(),
    module: z.string().optional(),
    requirementRef: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});
export const testCasesGetSchema = z.object({ ...sessionField, id: z.string().min(1) });
export const testCasesDeleteSchema = z.object({ ...sessionField, id: z.string().min(1) });

const testStepSchema = z.object({
  id: z.string(),
  type: z.string(),
  target: z.any().optional(),
  value: z.any().optional(),
  assertion: z.any().optional(),
  flowRef: z.any().optional(),
  enabled: z.boolean(),
  note: z.string().optional(),
  screenshotOnStep: z.boolean().optional(),
});
const testModelSchema = z.object({
  schemaVersion: z.literal(1),
  testCaseId: z.string(),
  name: z.string(),
  projectId: z.string(),
  tags: z.array(z.string()),
  steps: z.array(testStepSchema),
});
export const testCasesSaveModelSchema = z.object({
  ...sessionField,
  testCaseId: z.string().min(1),
  model: testModelSchema,
});

export const codegenGenerateSchema = z.object({
  ...sessionField,
  testCaseId: z.string().min(1),
  forcePaths: z.array(z.string()).optional(),
});
export const codegenGetMappingSchema = z.object({ ...sessionField, testCaseId: z.string().min(1) });
export const codegenReadFileSchema = z.object({
  ...sessionField,
  projectId: z.string().min(1),
  relativePath: z.string().min(1),
});

export const executionRunSchema = z.object({
  ...sessionField,
  request: z.object({
    projectId: z.string().min(1),
    environmentId: z.string().min(1),
    testCaseIds: z.array(z.string()).min(1),
    triggerType: z.enum(["single", "suite", "bvt", "smoke", "sanity", "regression", "custom"]),
    browser: z.enum(["chromium", "chrome", "firefox", "edge", "webkit"]),
    mode: z.enum(["headed", "headless"]),
    buildId: z.string().optional(),
    screenshotStrategy: z.enum(["failureOnly", "everyStep", "disabled"]).optional(),
  }),
});
export const executionListSchema = z.object({ ...sessionField, projectId: z.string().min(1) });
export const executionGetSchema = z.object({ ...sessionField, executionId: z.string().min(1) });

export const runtimeCheckSchema = z.object({ ...sessionField, projectId: z.string().min(1) });
export const runtimeLastCheckSchema = z.object({ ...sessionField });

export const browsersListSchema = z.object({ ...sessionField });
export const frameworksListSchema = z.object({ ...sessionField });

export const analyticsDashboardSchema = z.object({ ...sessionField, projectId: z.string().min(1) });

export const recorderStartSchema = z.object({
  ...sessionField,
  baseUrl: z.string().min(1),
  browser: z.enum(["chrome", "chromium", "firefox", "edge"]),
});
export const recorderStopSchema = z.object({ ...sessionField, recordingId: z.string().min(1) });
