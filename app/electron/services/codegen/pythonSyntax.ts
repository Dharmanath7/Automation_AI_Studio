/** Small helpers for emitting syntactically valid, readable Python from generators. */

export function pyStr(value: string): string {
  return JSON.stringify(value);
}

export function toSnakeCase(input: string): string {
  const cleaned = input
    // camelCase / PascalCase word boundary: lowercase-or-digit -> Uppercase
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // acronym followed by a new word: "XMLHttp" -> "XML_Http" (splits before
    // the last uppercase letter of a run when it starts a new titlecased
    // word — an all-caps run with no trailing word, like "DEMO1" or "URL",
    // is left intact instead of being shattered letter-by-letter, which is
    // what the previous `split(/(?=[A-Z])/)` did: "DEMO1" -> "d_e_m_o1".
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
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
