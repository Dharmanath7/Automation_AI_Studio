import { describe, it, expect } from "vitest";
import { validateTestModel, createEmptyTestModel, type TestModel } from "../../electron/shared/testModel";

function baseModel(): TestModel {
  const model = createEmptyTestModel({ testCaseId: "tc-1", projectId: "proj-1", name: "Search Provider" });
  model.steps = [
    {
      id: "s1",
      type: "navigate",
      value: { kind: "variable", path: "base_url" },
      enabled: true,
    },
  ];
  return model;
}

describe("validateTestModel", () => {
  it("accepts a well-formed model", () => {
    expect(validateTestModel(baseModel())).toEqual([]);
  });

  it("rejects an empty test name", () => {
    const model = { ...baseModel(), name: "" };
    const issues = validateTestModel(model);
    expect(issues.some((i) => i.message.includes("name is required"))).toBe(true);
  });

  it("rejects a model with no steps", () => {
    const model = { ...baseModel(), steps: [] };
    const issues = validateTestModel(model);
    expect(issues.some((i) => i.message.includes("at least one step"))).toBe(true);
  });

  it("rejects duplicate step ids", () => {
    const model = baseModel();
    model.steps.push({ ...model.steps[0], id: "s1" });
    const issues = validateTestModel(model);
    expect(issues.some((i) => i.message.includes("Duplicate step id"))).toBe(true);
  });

  it("rejects a click step with no target", () => {
    const model = baseModel();
    model.steps.push({ id: "s2", type: "click", enabled: true });
    const issues = validateTestModel(model);
    expect(issues.some((i) => i.message.includes("requires a target locator"))).toBe(true);
  });

  it("rejects a hardcoded environment URL in a navigate step", () => {
    const model = baseModel();
    model.steps[0].value = { kind: "literal", value: "https://tst.example.com/login" };
    const issues = validateTestModel(model, ["https://tst.example.com"]);
    expect(issues.some((i) => i.message.includes("{{base_url}}"))).toBe(true);
  });

  it("rejects a literal value on a password-labeled field", () => {
    const model = baseModel();
    model.steps.push({
      id: "s3",
      type: "fill",
      target: { preferred: { strategy: "role", value: "textbox", roleName: "Password", quality: "excellent" }, alternatives: [] },
      value: { kind: "literal", value: "hunter2" },
      enabled: true,
    });
    const issues = validateTestModel(model);
    expect(issues.some((i) => i.message.includes("Credential Vault"))).toBe(true);
  });
});
