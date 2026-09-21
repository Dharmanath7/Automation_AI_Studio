/** Small helpers for emitting syntactically valid, readable Python from generators. */

export function pyStr(value: string): string {
  return JSON.stringify(value);
}

export function toSnakeCase(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+|(?=[A-Z])/)
    .filter(Boolean)
    .join("_")
    .toLowerCase();
  return cleaned || "unnamed";
}

export function toPascalCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** A valid, non-empty Python identifier, guaranteed not to start with a digit. */
export function toPythonIdentifier(input: string, fallback = "field"): string {
  let id = toSnakeCase(input);
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return id;
}
