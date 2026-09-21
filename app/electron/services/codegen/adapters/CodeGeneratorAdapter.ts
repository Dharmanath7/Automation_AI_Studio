import type { TestModel } from "../../../shared/testModel";

export interface GeneratedFile {
  relativePath: string;
  content: string;
}

export interface CodeGenerationResult {
  testFile: GeneratedFile;
  pageObjectFiles: GeneratedFile[];
  supportFiles: GeneratedFile[];
  testFilePath: string;
  pageObjectPaths: string[];
  warnings: string[];
}

export interface GenerationContext {
  projectDirectory: string;
  projectCode: string;
  existingPageObjectNames: string[];
}

/**
 * A Code Generator Adapter turns a framework-neutral Test Model into real
 * source files for one specific language/framework/runner/style combination.
 * `generate()` must be a pure function — it never touches disk itself; the
 * caller (services/codegen/generationService.ts) decides how/whether to write
 * the result, respecting source-code ownership rules (docs/SECURITY.md §6).
 */
export interface CodeGeneratorAdapter {
  readonly language: string;
  readonly framework: string;
  readonly testRunner: string;
  readonly style: string;

  generate(model: TestModel, ctx: GenerationContext): CodeGenerationResult;
}
