-- Adds a plain-language description of the step that failed, alongside the
-- existing failed_step_index (which was already in the schema but never
-- actually populated by anything). The description is captured at
-- execution time from the generated code's own "# STEP n: ..." marker
-- comment (see PlaywrightPythonPytestGenerator.ts) rather than looked up
-- from the Test Model afterward, since the Test Model may have been edited
-- since the run that failed — the marker reflects exactly what actually ran.
ALTER TABLE execution_tests ADD COLUMN failed_step_description TEXT;
